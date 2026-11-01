import React from "react";
import { useI18n } from "../../i18n";
import "./remoteAccess.css";

export function RemoteAccessRequired() {
  const { locale } = useI18n();
  const zh = locale === "zh-CN";
  return <section className="remote-access-required">
    <h2>{zh ? "请使用 IDEA 中的访问链接" : "Use the access link from IDEA"}</h2>
    <p>{zh ? "在 IDEA 打开“远程访问”，扫描二维码，或复制链接到这个浏览器。" : "Open Remote access in IDEA, then scan the QR code or copy the link into this browser."}</p>
    <p className="remote-note">{zh ? "链接会自动完成连接，无需输入任何代码。已连接过的浏览器会记住授权；如果链接已更新，请重新复制。" : "The link connects automatically, with no codes to enter. This browser remembers access. If the link changed, copy it again."}</p>
  </section>;
}
