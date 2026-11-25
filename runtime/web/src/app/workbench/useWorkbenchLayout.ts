import {
  useResponsive,
  loadSidebarsSwapped,
  loadGitDiffSideBySide,
  SIDEBARS_SWAPPED_STORAGE_KEY,
  GIT_DIFF_SIDE_BY_SIDE_STORAGE_KEY,
} from "../storagePrefs";
import { useRemoteDevice } from "../../services/remoteDevice";
import { useState, useRef, useEffect } from "react";
import { type PhoneSessionFilter } from "../../components/remoteui/phoneSessionFacts";
import { isIdeaRuntime } from "../../services/ideaBridge";
import { isRemoteWebUi } from "../../services/remoteUi";
import { projectStorage } from "../../services/remoteScope";

export function useWorkbenchLayout() {
  const { isMobile: compactViewport } = useResponsive();
  const remoteDevice = useRemoteDevice();
  const remotePhone = remoteDevice === "phone";
  const isMobile = remoteDevice ? remotePhone : compactViewport;
  const [phoneFilter, setPhoneFilter] = useState<PhoneSessionFilter>("");
  const [sidebarsSwapped, setSidebarsSwapped] = useState(loadSidebarsSwapped);
  const [gitDiffSideBySide, setGitDiffSideBySide] = useState(
    loadGitDiffSideBySide,
  );
  const [isLeftOpen, setIsLeftOpen] = useState(
    () => !isIdeaRuntime && (remoteDevice ? !remotePhone && window.innerWidth >= 720 : window.innerWidth >= 768),
  );
  // 远程网页：窄于 1024（平板竖屏）时默认收起会话栏，宽屏默认展开。其他环境保持原来的 768。
  const [isRightOpen, setIsRightOpen] = useState(
    () => !isIdeaRuntime && !remotePhone && window.innerWidth >= (isRemoteWebUi ? 1024 : 768),
  );
  const previousRemoteDevice = useRef(remoteDevice);
  useEffect(() => {
    if (isMobile) { setIsLeftOpen(false); setIsRightOpen(false); }
    else if (remoteDevice && previousRemoteDevice.current === "phone") {
      setIsLeftOpen(true);
      setIsRightOpen(window.innerWidth >= 1024);
    }
    previousRemoteDevice.current = remoteDevice;
  }, [isMobile, remoteDevice]);
  useEffect(() => {
    try {
      projectStorage().setItem(
        SIDEBARS_SWAPPED_STORAGE_KEY,
        sidebarsSwapped ? "1" : "0",
      );
    } catch {
      // Ignore storage failures; the setting can still apply for this session.
    }
  }, [sidebarsSwapped]);
  useEffect(() => {
    try {
      projectStorage().setItem(
        GIT_DIFF_SIDE_BY_SIDE_STORAGE_KEY,
        gitDiffSideBySide ? "1" : "0",
      );
    } catch {
      // Ignore storage failures; the setting can still apply for this session.
    }
  }, [gitDiffSideBySide]);

  return { gitDiffSideBySide, isLeftOpen, isMobile, isRightOpen, phoneFilter, remoteDevice, remotePhone, setGitDiffSideBySide, setIsLeftOpen, setIsRightOpen, setPhoneFilter, setSidebarsSwapped, sidebarsSwapped };
}
