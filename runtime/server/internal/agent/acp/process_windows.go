//go:build windows

package acp

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

type windowsProcessTree struct {
	mu       sync.Mutex
	job      windows.Handle
	killed   bool
	seenPIDs map[uint32]struct{}
	procs    []windows.Handle
}

func startProcessCommand(cmd *exec.Cmd) (processTree, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, fmt.Errorf("create ACP job: %w", err)
	}
	tree := &windowsProcessTree{
		job:      job,
		seenPIDs: make(map[uint32]struct{}),
	}
	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits))); err != nil {
		return nil, errors.Join(fmt.Errorf("configure ACP job: %w", err), windows.CloseHandle(job))
	}

	// Keep cancellation from closing the job while the suspended process is
	// being assigned. No agent code can run before assignment succeeds.
	tree.mu.Lock()
	cmd.Cancel = tree.Kill
	cmd.SysProcAttr.CreationFlags |= windows.CREATE_SUSPENDED
	err = cmd.Start()
	if err == nil {
		err = assignAndResumeProcess(job, cmd.Process.Pid)
	}
	tree.mu.Unlock()
	if err != nil {
		var killErr, waitErr error
		if cmd.Process != nil {
			killErr = cmd.Process.Kill()
			if errors.Is(killErr, os.ErrProcessDone) {
				killErr = nil
			}
		}
		// Start will return no owner for the job: release it unconditionally,
		// including when assignment failed while the child was suspended.
		tree.mu.Lock()
		closeErr := windows.CloseHandle(job)
		tree.job = 0
		tree.mu.Unlock()
		if cmd.Process != nil {
			waitErr = cmd.Wait()
		}
		return nil, errors.Join(err, killErr, closeErr, waitErr)
	}
	return tree, nil
}

func assignAndResumeProcess(job windows.Handle, pid int) error {
	process, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return fmt.Errorf("open suspended ACP process: %w", err)
	}
	defer windows.CloseHandle(process)
	if err := windows.AssignProcessToJobObject(job, process); err != nil {
		return fmt.Errorf("assign ACP process to job: %w", err)
	}

	// os/exec closes the primary thread handle. Recover it from a snapshot
	// while the process is still suspended, before it can create other threads.
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPTHREAD, 0)
	if err != nil {
		return fmt.Errorf("snapshot ACP threads: %w", err)
	}
	defer windows.CloseHandle(snapshot)
	entry := windows.ThreadEntry32{Size: uint32(unsafe.Sizeof(windows.ThreadEntry32{}))}
	for err = windows.Thread32First(snapshot, &entry); err == nil; err = windows.Thread32Next(snapshot, &entry) {
		if entry.OwnerProcessID != uint32(pid) {
			continue
		}
		thread, err := windows.OpenThread(windows.THREAD_SUSPEND_RESUME, false, entry.ThreadID)
		if err != nil {
			return fmt.Errorf("open suspended ACP thread: %w", err)
		}
		defer windows.CloseHandle(thread)
		if _, err := windows.ResumeThread(thread); err != nil {
			return fmt.Errorf("resume ACP thread: %w", err)
		}
		return nil
	}
	return fmt.Errorf("find suspended ACP thread for pid %d: %w", pid, err)
}

func (t *windowsProcessTree) Kill() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.job == 0 {
		return os.ErrProcessDone
	}
	t.captureJobProcessesLocked(t.job)
	if t.killed {
		return nil
	}
	if err := windows.TerminateJobObject(t.job, 1); err != nil {
		return err
	}
	t.killed = true
	return nil
}

func (t *windowsProcessTree) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	job := t.job
	if job == 0 {
		return nil
	}
	t.job = 0
	defer func() {
		for _, h := range t.procs {
			_ = windows.CloseHandle(h)
		}
		t.procs = nil
	}()

	t.captureJobProcessesLocked(job)

	var termErr, waitErr error
	if !t.killed {
		if err := windows.TerminateJobObject(job, 1); err != nil {
			termErr = fmt.Errorf("terminate ACP job: %w", err)
		} else {
			t.killed = true
		}
	}
	if termErr == nil {
		// Waiting only for cmd.exe or ActiveProcesses == 0 is not enough on
		// Windows: job accounting drops to 0 before kernel address-space teardown
		// signals each descendant EPROCESS object. Poll ActiveProcesses == 0 and
		// then wait on every captured process handle until signaled.
		deadline := time.Now().Add(5 * time.Second)
		for {
			t.captureJobProcessesLocked(job)
			active, err := activeJobProcesses(job)
			if err != nil {
				waitErr = fmt.Errorf("query ACP job: %w", err)
				break
			}
			if active == 0 {
				break
			}
			if time.Now().After(deadline) {
				waitErr = fmt.Errorf("ACP job did not exit after kill: active_processes=%d", active)
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		if waitErr == nil {
			waitErr = waitProcessHandles(t.procs, deadline)
		}
	}
	// Always release the non-inheritable job handle even on terminate/query/wait
	// errors so the handle never leaks and KILL_ON_JOB_CLOSE still takes effect.
	closeErr := windows.CloseHandle(job)
	return errors.Join(termErr, waitErr, closeErr)
}

func (t *windowsProcessTree) captureJobProcessesLocked(job windows.Handle) {
	pids, err := queryJobProcessIDs(job)
	if err != nil {
		return
	}
	for _, pid := range pids {
		if pid == 0 {
			continue
		}
		if _, seen := t.seenPIDs[pid]; seen {
			continue
		}
		h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, pid)
		if err != nil {
			continue
		}
		t.seenPIDs[pid] = struct{}{}
		t.procs = append(t.procs, h)
	}
}

func queryJobProcessIDs(job windows.Handle) ([]uint32, error) {
	const headerSize = 8 // two uint32 fields: NumberOfAssignedProcesses, NumberOfProcessIdsInList
	ptrSize := int(unsafe.Sizeof(uintptr(0)))
	capacity := 64
	for range 4 {
		buf := make([]byte, headerSize+capacity*ptrSize)
		err := windows.QueryInformationJobObject(
			job,
			windows.JobObjectBasicProcessIdList,
			uintptr(unsafe.Pointer(&buf[0])),
			uint32(len(buf)),
			nil,
		)
		assigned := *(*uint32)(unsafe.Pointer(&buf[0]))
		count := *(*uint32)(unsafe.Pointer(&buf[4]))
		if errors.Is(err, windows.ERROR_MORE_DATA) {
			if int(assigned) >= capacity {
				capacity = int(assigned) + 16
			} else {
				capacity *= 2
			}
			continue
		}
		if err != nil {
			return nil, err
		}
		if int(count) > capacity {
			count = uint32(capacity)
		}
		ids := unsafe.Slice((*uintptr)(unsafe.Pointer(&buf[headerSize])), int(count))
		out := make([]uint32, 0, len(ids))
		for _, id := range ids {
			out = append(out, uint32(id))
		}
		return out, nil
	}
	return nil, windows.ERROR_MORE_DATA
}

func waitProcessHandles(handles []windows.Handle, deadline time.Time) error {
	for _, h := range handles {
		remaining := time.Until(deadline)
		if remaining < 0 {
			remaining = 0
		}
		ms := uint32(remaining / time.Millisecond)
		state, err := windows.WaitForSingleObject(h, ms)
		if err != nil {
			return fmt.Errorf("wait ACP job process: %w", err)
		}
		if state != windows.WAIT_OBJECT_0 {
			return fmt.Errorf("ACP job process did not exit after kill: wait_state=%d", state)
		}
	}
	return nil
}

func activeJobProcesses(job windows.Handle) (uint32, error) {
	// JOBOBJECT_BASIC_ACCOUNTING_INFORMATION is not exposed by x/sys/windows.
	var info struct {
		TotalUserTime             int64
		TotalKernelTime           int64
		ThisPeriodTotalUserTime   int64
		ThisPeriodTotalKernelTime int64
		TotalPageFaultCount       uint32
		TotalProcesses            uint32
		ActiveProcesses           uint32
		TotalTerminatedProcesses  uint32
	}
	err := windows.QueryInformationJobObject(job, windows.JobObjectBasicAccountingInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)), nil)
	return info.ActiveProcesses, err
}

func configurePlatformProcessCommand(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windowsACPProcessCreationFlags(),
	}
}
