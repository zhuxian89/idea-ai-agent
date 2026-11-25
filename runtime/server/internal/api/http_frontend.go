package api

import (
	"fmt"
	htmpl "html/template"
	"net/http"
	"os"
	stdpath "path"
	"path/filepath"
	"regexp"
	"strings"
)

var indexResourceRefPattern = regexp.MustCompile(`(?i)\b(?:src|href)\s*=\s*["']([^"']+)["']`)

func (h *HTTPHandler) handleFrontend(w http.ResponseWriter, r *http.Request) {
	if h.serveStaticAsset(w, r) {
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(renderFallbackFrontend(indexHTML, frontendAssetMissingNotice(r.URL.Path))))
}

func (h *HTTPHandler) serveStaticAsset(w http.ResponseWriter, r *http.Request) bool {
	staticDir := strings.TrimSpace(h.StaticDir)
	if staticDir == "" {
		return false
	}

	cleanPath := pathForStaticAsset(r.URL.Path)
	if cleanPath == "" {
		cleanPath = "index.html"
	}

	assetPath := filepath.Join(staticDir, cleanPath)
	info, statErr := os.Stat(assetPath)
	if statErr == nil && !info.IsDir() {
		applyStaticCacheHeaders(w, cleanPath)
		if cleanPath == "index.html" {
			h.serveFrontendIndex(w, r, staticDir, assetPath)
			return true
		}
		http.ServeFile(w, r, assetPath)
		return true
	}

	if filepath.Ext(cleanPath) != "" {
		http.NotFound(w, r)
		return true
	}

	indexPath := filepath.Join(staticDir, "index.html")
	if info, err := os.Stat(indexPath); err == nil && !info.IsDir() {
		applyStaticCacheHeaders(w, "index.html")
		h.serveFrontendIndex(w, r, staticDir, indexPath)
		return true
	}

	return false
}

func (h *HTTPHandler) serveFrontendIndex(w http.ResponseWriter, r *http.Request, staticDir, indexPath string) {
	content, err := os.ReadFile(indexPath)
	if err != nil {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(renderFallbackFrontend(indexHTML, frontendAssetMissingNotice(r.URL.Path))))
		return
	}
	if missing := missingFrontendIndexResource(staticDir, content); missing != "" {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(renderFallbackFrontend(indexHTML, frontendAssetMissingNotice(missing))))
		return
	}
	if h.Standalone {
		metadata := `<head><meta name="local-ai-agent-mode" content="standalone">` +
			`<meta name="local-ai-agent-version" content="` + htmpl.HTMLEscapeString(h.Version) + `">`
		content = []byte(strings.Replace(string(content), "<head>", metadata, 1))
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(content)
		return
	}
	http.ServeFile(w, r, indexPath)
}

func missingFrontendIndexResource(staticDir string, indexContent []byte) string {
	matches := indexResourceRefPattern.FindAllSubmatch(indexContent, -1)
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		cleanPath := cleanFrontendResourcePath(string(match[1]))
		if cleanPath == "" {
			continue
		}
		info, err := os.Stat(filepath.Join(staticDir, cleanPath))
		if err != nil || info.IsDir() {
			return "/" + filepath.ToSlash(cleanPath)
		}
	}
	return ""
}

func cleanFrontendResourcePath(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" || strings.HasPrefix(value, "#") {
		return ""
	}
	lower := strings.ToLower(value)
	for _, prefix := range []string{"http://", "https://", "data:", "blob:", "mailto:", "tel:"} {
		if strings.HasPrefix(lower, prefix) {
			return ""
		}
	}
	if idx := strings.IndexAny(value, "?#"); idx >= 0 {
		value = value[:idx]
	}
	value = strings.TrimPrefix(value, "./")
	value = strings.TrimPrefix(value, "/")
	value = filepath.Clean(value)
	if value == "." || strings.HasPrefix(value, ".."+string(filepath.Separator)) || value == ".." || filepath.IsAbs(value) {
		return ""
	}
	return value
}

func frontendAssetMissingNotice(requestPath string) string {
	cleanPath := pathForStaticAsset(requestPath)
	if cleanPath == "" {
		cleanPath = "index.html"
	}
	displayPath := filepath.ToSlash(cleanPath)
	return fmt.Sprintf("frontend assets missing: web/%s not found. Please reinstall or check the install directory.", displayPath)
}

func renderFallbackFrontend(content, notice string) string {
	out := content
	noticeHTML := ""
	if strings.TrimSpace(notice) != "" {
		noticeHTML = `<div class="notice is-visible">` + htmpl.HTMLEscapeString(notice) + `</div>`
	}
	out = strings.ReplaceAll(out, "__FALLBACK_NOTICE__", noticeHTML)
	return out
}

func applyStaticCacheHeaders(w http.ResponseWriter, cleanPath string) {
	switch cleanPath {
	case "service-worker.js", "index.html":
		w.Header().Set("Cache-Control", "no-cache")
		return
	}

	if strings.HasPrefix(cleanPath, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
}

func pathForStaticAsset(requestPath string) string {
	// requestPath 是 URL path，分隔符固定为正斜杠。这里不能用 filepath，
	// 否则 Windows 会把前导 // 当成 UNC 路径，最终泄漏成 web/// 这类路径。
	cleaned := stdpath.Clean("/" + requestPath)
	if cleaned == "/" {
		return ""
	}
	return strings.TrimPrefix(cleaned, "/")
}

const indexHTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MindFS</title>
    <style>
      :root {
        color-scheme: light;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Avenir Next", "Helvetica Neue", Arial, sans-serif;
        background: #f7f7f5;
        color: #222;
      }
      .notice {
        display: none;
        margin: 12px;
        padding: 10px 12px;
        border: 1px solid #d8b4b4;
        border-radius: 6px;
        background: #fff5f5;
        color: #8a1f1f;
        font-size: 13px;
        line-height: 1.45;
      }
      .notice.is-visible {
        display: block;
      }
      .shell {
        display: grid;
        grid-template-columns: 260px 1fr;
        grid-template-rows: 1fr 64px;
        height: 100vh;
        background: #fff;
      }
      aside {
        grid-row: 1 / span 2;
        border-right: 1px solid #e5e5e5;
        padding: 12px;
        overflow: auto;
        background: linear-gradient(180deg, #faf9f6 0%, #ffffff 100%);
      }
      main {
        padding: 16px;
        overflow: auto;
      }
      footer {
        border-top: 1px solid #e5e5e5;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .file-button {
        display: block;
        width: 100%;
        text-align: left;
        border: none;
        background: transparent;
        padding: 4px 0;
        cursor: pointer;
        color: #333;
      }
      .card {
        border: 1px solid #e5e5e5;
        border-radius: 8px;
        padding: 10px 12px;
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
        background: #fff;
      }
      .status {
        font-size: 12px;
        color: #666;
      }
      input[type="text"] {
        flex: 1;
        padding: 8px 10px;
        border-radius: 6px;
        border: 1px solid #ccc;
      }
      button {
        padding: 8px 12px;
        border-radius: 6px;
        border: 1px solid #ccc;
        background: #f5f5f5;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    __FALLBACK_NOTICE__
    <div class="shell">
      <aside>
        <h3>Files</h3>
        <div id="tree">加载中...</div>
      </aside>
      <main>
        <h2 style="margin-top: 0;">Workspace</h2>
        <div id="list"></div>
      </main>
      <footer>
        <input type="text" placeholder="Ask or type a command..." />
        <button type="button">Run</button>
        <span class="status" id="status">Connected</span>
      </footer>
    </div>
    <script>
      var root = new URLSearchParams(window.location.search).get("root") || "";
      fetch("/api/tree?" + new URLSearchParams({ root: root, dir: "." }).toString())
        .then(function (res) { return res.json(); })
        .then(function (payload) {
          var tree = Array.isArray(payload) ? payload : (Array.isArray(payload.entries) ? payload.entries : []);
          var treeEl = document.getElementById("tree");
          var listEl = document.getElementById("list");
          treeEl.innerHTML = "";
          listEl.innerHTML = "";
          tree.forEach(function (entry) {
            var btn = document.createElement("button");
            btn.className = "file-button";
            btn.textContent = (entry.is_dir ? "📁 " : "📄 ") + entry.name;
            treeEl.appendChild(btn);

            var card = document.createElement("div");
            card.className = "card";
            card.innerHTML = "<span>" + entry.name + "</span><span>" + (entry.is_dir ? "Folder" : "File") + "</span>";
            listEl.appendChild(card);
          });
        })
        .catch(function () {
          var treeEl = document.getElementById("tree");
          treeEl.textContent = "无法加载目录树";
        });
    </script>
  </body>
</html>`
