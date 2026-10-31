# 网页版 / PWA 部署说明

这是一个纯静态网页应用，不需要服务器，不需要数据库，可以部署到 GitHub Pages、Cloudflare Pages 或任意静态网站空间。

## 包含的功能

- 导入 CHM
- 书架保存，刷新/重开仍在
- 目录（GBK / GB18030 / Big5 / UTF-8）
- 阅读页
- 上一页 / 下一页
- 搜索：标题模式 / 全文模式，全文模式标题命中优先
- 夜间模式
- 阅读页右上角 Aa 调字号
- 记住上次阅读页
- 离线可用
- 不上传 CHM，书只保存在当前浏览器

## 部署到 GitHub Pages

1. 在 GitHub 新建一个仓库，例如 `chm-reader`。
2. 把本目录里的文件上传到仓库根目录：
   - `index.html`
   - `styles.css`
   - `app.js`
   - `db.js`
   - `chm.js`
   - `legacy-tables.js`
   - `chm.wasm`
   - `sw.js`
   - `manifest.webmanifest`
   - `icons/` 整个目录
3. 打开仓库 **Settings → Pages**。
4. **Build and deployment → Source** 选择 **Deploy from a branch**。
5. Branch 选择 `main`，目录选择 `/ (root)`，保存。
6. 等 1–2 分钟，访问：

```text
https://你的用户名.github.io/chm-reader/
```

7. iPhone Safari 打开后：

```text
分享 → 添加到主屏幕
```

安卓 Chrome：

```text
菜单 → 安装应用 / 添加到主屏幕
```

> 必须是 HTTPS。GitHub Pages 默认就是 HTTPS。

## 部署到 Cloudflare Pages

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Upload assets。
2. 把整个 `web` 文件夹拖进去。
3. 部署完成后会得到一个 `*.pages.dev` 链接。
4. 手机打开链接，添加到主屏幕。

Cloudflare Pages 支持自定义域名；不使用自定义域名也完全免费。

## 本地测试

需要 Python 或 Node：

```bash
cd web
python -m http.server 8099
```

然后打开 `http://127.0.0.1:8099/`。

不要直接双击 `index.html`，`file://` 下 Service Worker 和模块会受限。

## 更新网页版

替换文件后，如果手机仍显示旧版：

1. 修改 `sw.js` 第一行：

```js
const CACHE = 'chm-shelf-v2';
```

2. 重新上传。
3. 手机彻底关闭网页再打开，或删除主屏幕图标后重新添加。

## 数据保存说明

- 书保存在浏览器的 IndexedDB 中，不上传。
- 换手机、换浏览器、清理 Safari 数据后不会自动恢复。
- iPhone 空间不足时，系统可能清理网页数据；重要 CHM 原文件请自己保留。
- 建议添加到主屏幕并定期打开一次。
- 朋友打开同一个网址后，各自导入自己的书，书架不会互通。

## 限制

- iOS Safari 的网页存储不如原生 App 稳；不能保证永久不丢。
- 特别大的 CHM（>100MB）导入会占用较多手机空间，建议先试一本。
- 网页版不使用原生 WebView，而是浏览器 iframe + Service Worker 提供 CHM 内部资源。
- 部分 CHM 使用绝对路径 `/xxx` 引用资源，可能无法映射；当前测试书正常。
