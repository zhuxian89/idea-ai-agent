// Package sysstats reports the CPU and memory load of the machine that runs the backend.
package sysstats

import (
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/mem"
)

// Sample is one reading. Percentages are 0 to 100.
type Sample struct {
	Host        string  `json:"host"`
	CPUPercent  float64 `json:"cpu_percent"`
	CPUCores    int     `json:"cpu_cores"`
	MemPercent  float64 `json:"mem_percent"`
	MemUsed     uint64  `json:"mem_used"`
	MemTotal    uint64  `json:"mem_total"`
	SampledAtMS int64   `json:"sampled_at_ms"`
}

// minInterval bounds how often the system is read: every browser polling this machine shares
// one reading, and a CPU percentage measured over a shorter window is mostly noise.
const minInterval = time.Second

type Collector struct {
	mu     sync.Mutex
	last   Sample
	lastAt time.Time
	primed bool
	cores  int
	host   string
}

func NewCollector() *Collector {
	host, _ := os.Hostname()
	return &Collector{cores: runtime.NumCPU(), host: host}
}

// Read returns the latest sample, reading the system at most once per second.
// The CPU figure is the average load since the previous reading, so the first call primes the
// counters and waits briefly to have something to measure.
func (c *Collector) Read() (Sample, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	if c.primed && now.Sub(c.lastAt) < minInterval {
		return c.last, nil
	}
	if !c.primed {
		if _, err := cpu.Percent(0, false); err != nil {
			return Sample{}, err
		}
		time.Sleep(200 * time.Millisecond)
		now = time.Now()
	}
	percents, err := cpu.Percent(0, false)
	if err != nil {
		return Sample{}, err
	}
	memory, err := mem.VirtualMemory()
	if err != nil {
		return Sample{}, err
	}
	sample := Sample{
		Host:        c.host,
		CPUCores:    c.cores,
		MemTotal:    memory.Total,
		SampledAtMS: now.UnixMilli(),
	}
	if len(percents) > 0 {
		sample.CPUPercent = clamp(percents[0])
	}
	if memory.Total > 0 {
		sample.MemUsed = memory.Total - memory.Available
		sample.MemPercent = clamp(float64(sample.MemUsed) / float64(memory.Total) * 100)
	}
	c.last, c.lastAt, c.primed = sample, now, true
	return sample, nil
}

func clamp(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}
