import { isIdeaRuntime } from "../../services/ideaBridge";
import { FileViewer } from "../../components/FileViewer";
import { RemoteFileViewer } from "../../components/remote/RemoteFileViewer";

export const WorkspaceFileViewer = isIdeaRuntime ? FileViewer : RemoteFileViewer;
