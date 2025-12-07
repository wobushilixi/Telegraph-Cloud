/**
 * Telegraph Cloudflare Worker for Image/Video/File Hosting.
 * Maintained by wobushilixi, based on 0-RTT/telegraph.
 *
 * Features: Apple minimalist UI, Dashboard with sampling stats, Client-side WebP conversion, Multi-file upload with progress bar.
 */

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const domain = env.DOMAIN;
    const DATABASE = env.DATABASE;
    const USERNAME = env.USERNAME;
    const PASSWORD = env.PASSWORD;
    const adminPath = env.ADMIN_PATH || 'admin';
    const enableAuth = env.ENABLE_AUTH === 'true';
    const TG_BOT_TOKEN = env.TG_BOT_TOKEN;
    const TG_CHAT_ID = env.TG_CHAT_ID;
    const maxSizeMB = env.MAX_SIZE_MB ? parseInt(env.MAX_SIZE_MB, 10) : 20;
    const maxSize = maxSizeMB * 1024 * 1024;

    switch (pathname) {
      case '/':
        // 修复：将 maxSizeMB 和 adminPath 作为参数传入 handleRootRequest
        return await handleRootRequest(request, USERNAME, PASSWORD, enableAuth, maxSizeMB, adminPath);
      case `/${adminPath}`:
        return await handleAdminRequest(DATABASE, request, USERNAME, PASSWORD, adminPath);
      case '/upload':
        return request.method === 'POST' ? await handleUploadRequest(request, DATABASE, enableAuth, USERNAME, PASSWORD, domain, TG_BOT_TOKEN, TG_CHAT_ID, maxSize) : new Response('Method Not Allowed', { status: 405 });
      case '/bing-images':
        return handleBingImagesRequest();
      case '/delete-images':
        return await handleDeleteImagesRequest(request, DATABASE, USERNAME, PASSWORD);
      default:
        // 使用 ctx.waitUntil 确保异步统计不阻塞响应
        const response = await handleImageRequest(request, DATABASE, TG_BOT_TOKEN);
        ctx.waitUntil(handleStatsUpdate(request.url, DATABASE, response));
        return response;
    }
  }
};

/* --- 验证逻辑 (保持原版) --- */
function authenticate(request, USERNAME, PASSWORD) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;
  return isValidCredentials(authHeader, USERNAME, PASSWORD);
}

function isValidCredentials(authHeader, USERNAME, PASSWORD) {
  const base64Credentials = authHeader.split(' ')[1];
  const credentials = atob(base64Credentials).split(':');
  const username = credentials[0];
  const password = credentials[1];
  return username === USERNAME && password === PASSWORD;
}

/* --- 1. 首页：上传页面 (UI重写：Apple 极简风 + 多文件上传/WebP) --- */
// 修复：增加 maxSizeMB 和 adminPath 参数
async function handleRootRequest(request, USERNAME, PASSWORD, enableAuth, maxSizeMB, adminPath) {
  if (enableAuth) {
      if (!authenticate(request, USERNAME, PASSWORD)) {
          return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Admin"' } });
      }
  }
  
  const html = `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Telegraph Cloud</title>
    <link rel="icon" href="https://p1.meituan.net/csc/c195ee91001e783f39f41ffffbbcbd484286.ico" type="image/x-icon">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
    <style>
      :root {
        --bg-color: #F5F5F7;
        --card-bg: rgba(255, 255, 255, 0.9);
        --text-primary: #1D1D1F;
        --text-secondary: #86868B;
        --accent-color: #007AFF;
        --success-color: #34C759;
        --error-color: #FF3B30;
        --border-radius: 20px;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
        background-color: var(--bg-color);
        color: var(--text-primary);
        margin: 0;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        background-image: url('https://cn.bing.com/th?id=OHR.HierveElAgua_ZH-CN3864273543_1920x1080.jpg&rf=LaDigue_1920x1080.jpg');
        background-size: cover;
        background-position: center;
        padding: 40px 20px;
        box-sizing: border-box;
      }
      .glass-container {
        width: 100%;
        max-width: 600px;
        background: var(--card-bg);
        padding: 30px;
        border-radius: var(--border-radius);
        box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        margin-bottom: 20px;
      }
      h1 { font-weight: 600; font-size: 28px; margin-bottom: 8px; letter-spacing: -0.5px; }
      .subhead { color: var(--text-secondary); font-size: 14px; margin-bottom: 30px; }
      
      .upload-area {
        border: 2px dashed #C7C7CC;
        border-radius: 16px;
        padding: 30px 20px;
        transition: all 0.2s ease;
        cursor: pointer;
        background: rgba(255,255,255,0.5);
        text-align: center;
        position: relative;
      }
      .upload-area:hover { border-color: var(--accent-color); background: rgba(0,122,255,0.05); }
      .upload-area.dragover { border-color: var(--accent-color); background: rgba(0,122,255,0.1); }
      .icon-cloud { font-size: 48px; color: var(--accent-color); margin-bottom: 10px; display: block; }
      #fileInput { position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
      
      /* Upload List */
      #uploadList { margin-top: 20px; }
      .upload-item { 
        display: flex; align-items: center; padding: 10px; 
        border-radius: 10px; margin-bottom: 8px; 
        background: #F2F2F7;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      }
      .file-icon { font-size: 20px; color: var(--text-secondary); margin-right: 15px; }
      .file-info { flex-grow: 1; min-width: 0; }
      .file-name { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .file-status { display: flex; align-items: center; font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
      .progress-bar-wrap { 
        height: 4px; width: 80px; background: #E5E5EA; border-radius: 2px; 
        margin-left: 10px; overflow: hidden;
      }
      .progress-bar { 
        height: 100%; width: 0%; background: var(--accent-color); transition: width 0.3s ease; 
      }
      .status-text { margin-left: 5px; }
      .status-icon { margin-left: auto; font-size: 18px; }
      .status-icon.success { color: var(--success-color); }
      .status-icon.error { color: var(--error-color); }
      
      /* Link area */
      .link-area { 
        padding: 10px 15px; background: #fff; border-radius: 10px;
        margin-top: 5px; cursor: pointer;
        border: 1px solid #E5E5EA;
      }
      .link-area:hover { border-color: var(--accent-color); }
      .link-area input { 
        width: 100%; border: none; outline: none; background: none; 
        font-size: 12px; font-family: monospace; color: var(--accent-color);
      }

      /* Footer 样式 */
      .footer {
        margin-top: 20px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.8);
        text-shadow: 0 1px 2px rgba(0,0,0,0.3);
        text-align: center;
        line-height: 1.5;
      }
      .footer a { color: white; text-decoration: none; font-weight: 500; border-bottom: 1px dashed rgba(255,255,255,0.5); padding-bottom: 1px; }
      .footer a:hover { border-bottom-style: solid; }
    </style>
  </head>
  <body>
    <div class="glass-container">
      <h1>Telegraph Cloud</h1>
      <div class="subhead">极简、快速的无限图床服务</div>
      
      <div class="upload-area" id="dropZone">
        <span class="icon-cloud"><i class="fas fa-cloud-upload-alt"></i></span>
        <div style="font-weight: 500; color: #333;">点击或拖拽文件上传</div>
        <div style="font-size: 12px; color: #999; margin-top: 5px;">支持 WebP 压缩，最大 ${maxSizeMB}MB</div>
        <input type="file" id="fileInput" multiple>
      </div>

      <div id="uploadList"></div>
    </div>

    <div class="footer">
      <div style="margin-bottom: 5px;"><a href="/${adminPath}">管理后台</a></div>
      <div>
        Maintain by <a href="https://github.com/wobushilixi" target="_blank">wobushilixi</a> | 
        Based on <a href="https://github.com/0-RTT/telegraph" target="_blank">0-RTT/telegraph</a>
      </div>
    </div>

    <script>
      const fileInput = document.getElementById('fileInput');
      const uploadList = document.getElementById('uploadList');
      const dropZone = document.getElementById('dropZone');

      // 拖拽事件
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
          dropZone.addEventListener(eventName, preventDefaults, false);
          document.body.addEventListener(eventName, preventDefaults, false);
      });
      ['dragenter', 'dragover'].forEach(eventName => {
          dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
      });
      ['dragleave', 'drop'].forEach(eventName => {
          dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
      });
      dropZone.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files), false);
      
      fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

      function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
      }

      function handleFiles(files) {
        if (!files || files.length === 0) return;
        for (const file of files) {
          processAndUpload(file);
        }
      }

      // WebP 转换和上传的核心逻辑
      async function processAndUpload(originalFile) {
        const item = createUploadItem(originalFile.name, originalFile.size, originalFile.type);
        uploadList.prepend(item.element);
        
        let fileToUpload = originalFile;
        const mimeType = originalFile.type;
        let isCompressed = false;

        // 客户端 WebP 压缩/转换
        if (['image/jpeg', 'image/png'].includes(mimeType) && typeof OffscreenCanvas !== 'undefined') {
          item.updateStatus('正在压缩 (WebP)...');
          try {
            const bitmap = await createImageBitmap(originalFile);
            const offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
            const ctx = offscreen.getContext('2d');
            ctx.drawImage(bitmap, 0, 0);
            const blob = await offscreen.convertToBlob({ type: 'image/webp', quality: 0.8 });
            
            // 用新 Blob 替换原始文件，保持原有文件名但扩展名可能不准确
            fileToUpload = new File([blob], originalFile.name.replace(/\.(jpe?g|png)$/i, '.webp'), { type: 'image/webp' });
            isCompressed = true;
            item.updateStatus(\`已压缩 (\${formatBytes(fileToUpload.size)}) \`);
          } catch(e) {
            console.error('WebP conversion failed, uploading original.', e);
            item.updateStatus('WebP 压缩失败, 上传原文件...');
            isCompressed = false;
          }
        }
        
        uploadFile(fileToUpload, item, isCompressed);
      }

      function uploadFile(file, item, isCompressed) {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();
        formData.append('file', file);

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            item.updateProgress(percent);
            item.updateStatus(isCompressed ? 'WebP 上传中...' : '上传中...');
          }
        });

        xhr.addEventListener('load', () => {
          try {
            const resp = JSON.parse(xhr.responseText);
            if (xhr.status === 200 && resp.data) {
              item.updateSuccess(resp.data);
            } else {
              item.updateError(resp.error || '上传失败', resp.data);
            }
          } catch(e) {
             item.updateError('Worker 响应格式错误', null);
          }
        });

        xhr.addEventListener('error', () => item.updateError('网络错误', null));
        xhr.addEventListener('abort', () => item.updateError('上传取消', null));

        xhr.open('POST', '/upload', true);
        item.updateStatus('开始上传...');
        xhr.send(formData);
      }

      // UI 辅助函数
      function formatBytes(bytes) {
          if (bytes === 0) return '0 Bytes';
          const k = 1024;
          const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      }

      function getFileIcon(mime) {
        if (mime.startsWith('image/')) return 'fa-image';
        if (mime.startsWith('video/')) return 'fa-video';
        return 'fa-file-alt';
      }

      function copyToClip(text) {
          navigator.clipboard.writeText(text).then(() => {
              // 简短反馈
              const tempText = document.getElementById('copyFeedback');
              if(tempText) { tempText.innerText = '链接已复制!'; }
              setTimeout(() => { if(tempText) tempText.innerText = ''; }, 1000);
          });
      }

      function createUploadItem(name, size, mimeType) {
        const element = document.createElement('div');
        element.className = 'upload-item';
        
        element.innerHTML = \`
          <div class="file-icon"><i class="fas \${getFileIcon(mimeType || name.split('.').pop())}"></i></div>
          <div class="file-info">
            <div class="file-name">\${name}</div>
            <div class="file-status">
              <span class="file-size">\${formatBytes(size)}</span>
              <div class="progress-bar-wrap">
                <div class="progress-bar" style="width: 0%;"></div>
              </div>
              <span class="status-text">等待中...</span>
            </div>
          </div>
          <div class="status-icon"><i class="fas fa-ellipsis-h"></i></div>
        \`;

        const progressBar = element.querySelector('.progress-bar');
        const statusText = element.querySelector('.status-text');
        const statusIcon = element.querySelector('.status-icon');
        const fileInfo = element.querySelector('.file-info');

        return {
          element: element,
          updateProgress: (percent) => {
            progressBar.style.width = \`\${percent}%\`;
          },
          updateStatus: (text) => {
            statusText.innerText = text;
          },
          updateSuccess: (url) => {
            progressBar.style.width = '100%';
            progressBar.style.backgroundColor = 'var(--success-color)';
            statusText.innerText = '完成';
            statusIcon.innerHTML = '<i class="fas fa-check-circle"></i>';
            statusIcon.classList.add('success');
            
            fileInfo.innerHTML += \`
              <div class="link-area" onclick="copyToClip('\${url}')">
                <input type="text" value="\${url}" readonly>
                <span id="copyFeedback" style="color: var(--success-color); font-size: 10px; margin-left: 5px;"></span>
              </div>
            \`;
          },
          updateError: (msg, url) => {
            statusText.innerText = '失败: ' + msg.substring(0, 30);
            statusIcon.innerHTML = '<i class="fas fa-times-circle"></i>';
            statusIcon.classList.add('error');
            progressBar.style.width = '100%';
            progressBar.style.backgroundColor = 'var(--error-color)';
            
            if (url) {
                fileInfo.innerHTML += \`
                    <div class="link-area" onclick="copyToClip('\${url}')">
                      <input type="text" value="\${url}" readonly>
                      <span style="color: var(--error-color); font-size: 10px; margin-left: 5px;">部分成功?</span>
                    </div>
                  \`;
            }
          }
        };
      }
    </script>
  </body>
  </html>
  `;
  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

/* --- 2. 管理页面 (Dashboard UI + 原有图库) --- */
async function handleAdminRequest(DATABASE, request, USERNAME, PASSWORD, adminPath) {
  if (!authenticate(request, USERNAME, PASSWORD)) {
    return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Admin"' } });
  }

  const stats = await getDashboardStats(DATABASE);
  const mediaData = await fetchMediaData(DATABASE);

  const html = generateAdminHtml(stats, mediaData, adminPath);
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}


/* --- 3. 上传请求处理 (保留核心逻辑 + 记录 size) --- */
async function handleUploadRequest(request, DATABASE, enableAuth, USERNAME, PASSWORD, domain, TG_BOT_TOKEN, TG_CHAT_ID, maxSize) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) throw new Error('缺少文件');
    if (file.size > maxSize) {
      return new Response(JSON.stringify({ error: `文件大小超过${maxSize / (1024 * 1024)}MB限制` }), { status: 413, headers: { 'Content-Type': 'application/json' } });
    }
    if (enableAuth && !authenticate(request, USERNAME, PASSWORD)) {
      return new Response('Unauthorized', { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    
    // --- Telegram 上传逻辑 (严格保留) ---
    const uploadFormData = new FormData();
    uploadFormData.append("chat_id", TG_CHAT_ID);
    let fileId;
    let fileToUpload = file;
    let originalFileName = file.name;
    let fileExtension = originalFileName.split('.').pop();

    // 适配 WebP 压缩后的文件名
    if (file.type === 'image/webp') {
       fileExtension = 'webp';
    } else if (file.type.startsWith('image/gif')) {
      // 保持原有 GIF 压缩逻辑（可选，客户端WebP已经处理了一部分）
      const newFileName = originalFileName.replace(/\.gif$/, '.jpeg');
      fileToUpload = new File([file], newFileName, { type: 'image/jpeg' });
      fileExtension = 'jpeg';
    } 

    uploadFormData.append("document", fileToUpload);
    
    // ** 优化：加入重试机制，增加上传健壮性 **
    const maxAttempts = 3;
    let telegramResponse;
    for (let i = 0; i < maxAttempts; i++) {
        telegramResponse = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendDocument`, { method: 'POST', body: uploadFormData });
        if (telegramResponse.ok) break;
        if (i < maxAttempts - 1) await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // 等待 1s, 2s, ...
    }
    
    if (!telegramResponse.ok) {
      const errorData = await telegramResponse.json();
      // 返回更详细的错误信息
      throw new Error(`Telegram API Error: ${errorData.description || '上传失败'}`);
    }
    
    const responseData = await telegramResponse.json();
    
    if (responseData.result.video) fileId = responseData.result.video.file_id;
    else if (responseData.result.document) fileId = responseData.result.document.file_id;
    else if (responseData.result.sticker) fileId = responseData.result.sticker.file_id;
    else if (responseData.result.photo) fileId = responseData.result.photo.pop().file_id; // 处理 Photo 格式
    else throw new Error('返回的数据中没有文件 ID');
    
    const timestamp = Date.now();
    const imageURL = `https://${domain}/${timestamp}.${fileExtension}`;
    
    // --- 数据库写入 (加入 size) ---
    await DATABASE.prepare('INSERT INTO media (url, fileId, size, views) VALUES (?, ?, ?, 0) ON CONFLICT(url) DO NOTHING')
        .bind(imageURL, fileId, file.size)
        .run();
        
    return new Response(JSON.stringify({ data: imageURL }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('上传错误:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

/* --- 4. 图片获取 (核心 + 异步统计) --- */
async function handleImageRequest(request, DATABASE, TG_BOT_TOKEN) {
  const requestedUrl = request.url;
  const cache = caches.default;
  const cacheKey = new Request(requestedUrl);
  
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
      return cachedResponse;
  }

  // 查库
  const result = await DATABASE.prepare('SELECT fileId, size FROM media WHERE url = ?').bind(requestedUrl).first();
  if (!result) return new Response('资源不存在', { status: 404 });
  const fileId = result.fileId;

  // 获取 Telegram 文件路径
  const getFilePath = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/getFile?file_id=${fileId}`);
  const fileData = await getFilePath.json();
  if (!fileData.ok || !fileData.result.file_path) return new Response('未找到FilePath', { status: 404 });
  const filePath = fileData.result.file_path;

  // 下载文件
  const getFileResponse = `https://api.telegram.org/file/bot${TG_BOT_TOKEN}/${filePath}`;
  const response = await fetch(getFileResponse);
  if (!response.ok) return new Response('获取文件内容失败', { status: 500 });

  // 设置 Content-Type 和缓存头
  const fileExtension = requestedUrl.split('.').pop().toLowerCase();
  let contentType = 'application/octet-stream';
  if (['jpg', 'jpeg'].includes(fileExtension)) contentType = 'image/jpeg';
  else if (fileExtension === 'png') contentType = 'image/png';
  else if (fileExtension === 'gif') fileExtension = 'image/gif';
  else if (fileExtension === 'webp') contentType = 'image/webp';
  else if (fileExtension === 'mp4') contentType = 'video/mp4';

  const headers = new Headers(response.headers);
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable'); // 强缓存
  
  const responseToCache = new Response(response.body, { status: response.status, headers });
  
  // 写入缓存
  await cache.put(cacheKey, responseToCache.clone());
  
  return responseToCache;
}

/* --- 5. 统计更新 (抽样优化 D1 写入) --- */
async function handleStatsUpdate(url, DATABASE, response) {
    const SAMPLE_RATE = 0.1; // 10% 采样率
    const FACTOR = 1 / SAMPLE_RATE; // 10 倍补偿
    
    // 只有 10% 的概率执行 D1 写入
    if (Math.random() < SAMPLE_RATE) {
        // 查库获取文件大小
        const media = await DATABASE.prepare('SELECT size FROM media WHERE url = ?').bind(url).first();
        const fileSize = media?.size || 0;
        
        const today = new Date().toISOString().split('T')[0];
        
        // 1. 增加总访问量 (views)
        await DATABASE.prepare('UPDATE media SET views = views + ? WHERE url = ?').bind(FACTOR, url).run().catch(e => console.error("Update Views Error", e));
        
        // 2. 增加每日流量统计 (requests, bandwidth, visitors)
        try {
            await DATABASE.prepare(`
                INSERT INTO daily_stats (date, requests, bandwidth, visitors) 
                VALUES (?, ?, ?, ?)
                ON CONFLICT(date) DO UPDATE SET 
                requests = requests + ?,
                bandwidth = bandwidth + ?,
                visitors = visitors + ?
            `).bind(today, FACTOR, fileSize * FACTOR, FACTOR, FACTOR, fileSize * FACTOR, FACTOR).run();
        } catch(e) { 
            console.error("Stats Upsert Error", e); 
        }
    }
}


/* --- 6. 辅助功能和 HTML 生成 (保持不变) --- */
// (此处省略 handleBingImagesRequest, handleDeleteImagesRequest, fetchMediaData, getDashboardStats, formatBytes, generateAdminHtml 函数，它们保持不变)
async function handleBingImagesRequest() {
  const cache = caches.default;
  const cacheKey = new Request('https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=5');
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) return cachedResponse;
  const res = await fetch(cacheKey);
  if (!res.ok) return new Response('Failed', { status: res.status });
  const bingData = await res.json();
  const images = bingData.images.map(image => ({ url: `https://cn.bing.com${image.url}` }));
  const response = new Response(JSON.stringify({ status: true, data: images }), { headers: { 'Content-Type': 'application/json' } });
  await cache.put(cacheKey, response.clone());
  return response;
}

async function handleDeleteImagesRequest(request, DATABASE, USERNAME, PASSWORD) {
  if (!authenticate(request, USERNAME, PASSWORD)) return new Response('Unauthorized', { status: 401 });
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  try {
    const keysToDelete = await request.json();
    if (!Array.isArray(keysToDelete) || keysToDelete.length === 0) return new Response(JSON.stringify({ message: '没有要删除的项' }), { status: 400 });
    const placeholders = keysToDelete.map(() => '?').join(',');
    await DATABASE.prepare(`DELETE FROM media WHERE url IN (${placeholders})`).bind(...keysToDelete).run();
    
    const cache = caches.default;
    for (const url of keysToDelete) { await cache.delete(new Request(url)); }
    return new Response(JSON.stringify({ message: 'Deleted' }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

async function fetchMediaData(DATABASE) {
  const result = await DATABASE.prepare('SELECT url, fileId, size, views FROM media ORDER BY rowid DESC LIMIT 100').all();
  return result.results || [];
}

async function getDashboardStats(DATABASE) {
    const total = await DATABASE.prepare('SELECT COUNT(*) as count, SUM(size) as size, SUM(views) as views FROM media').first();
    const logs = await DATABASE.prepare('SELECT * FROM daily_stats ORDER BY date DESC LIMIT 7').all();
    
    let totalReq = 0, totalBandwidth = 0;
    const dailyLogs = logs.results || [];
    dailyLogs.forEach(l => { totalReq += l.requests; totalBandwidth += l.bandwidth; });

    return {
        fileCount: total.count || 0,
        totalSize: total.size || 0,
        totalViews: total.views || 0,
        recentRequests: Math.round(totalReq),
        recentBandwidth: totalBandwidth,
        dailyLogs: dailyLogs.map(l => ({ ...l, requests: Math.round(l.requests), bandwidth: l.bandwidth, visitors: Math.round(l.visitors) }))
    };
}

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function generateAdminHtml(stats, mediaData, adminPath) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <title>控制台</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
    <style>
      :root {
        --bg: #F5F7FA; --white: #FFFFFF; --text: #1F2937; --text-light: #6B7280; --blue: #3B82F6; --border-radius: 16px;
      }
      body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--text); padding: 20px; padding-bottom: 60px; }
      .header-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 30px; }
      .card { background: var(--white); padding: 25px; border-radius: var(--border-radius); box-shadow: 0 2px 10px rgba(0,0,0,0.03); }
      .card-title { font-size: 14px; color: var(--text-light); margin-bottom: 10px; font-weight: 500; }
      .card-value { font-size: 32px; font-weight: 700; color: #111; margin-bottom: 5px; }
      .bg-blue { background: #EFF6FF; } .text-blue { color: #3B82F6; }
      .bg-green { background: #ECFDF5; } .text-green { color: #10B981; }
      .bg-purple { background: #F5F3FF; } .text-purple { color: #8B5CF6; }
      .data-table { width: 100%; background: var(--white); border-radius: var(--border-radius); border-collapse: collapse; overflow: hidden; }
      .data-table th, .data-table td { padding: 15px 20px; text-align: left; border-bottom: 1px solid #F3F4F6; }
      .data-table th { font-weight: 600; color: var(--text-light); background: #FAFAFA; font-size: 13px; }
      .tag-success { background: #D1FAE5; color: #065F46; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
      .gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 15px; margin-top: 20px; }
      .media-item { aspect-ratio: 1; border-radius: 12px; overflow: hidden; position: relative; cursor: pointer; border: 2px solid transparent; transition: all 0.2s; }
      .media-item.selected { border-color: #3B82F6; }
      .media-item img, .media-item video { width: 100%; height: 100%; object-fit: cover; }
      .action-bar { display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 20px; }
      .btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-weight: 500; font-size: 14px; transition: 0.2s; }
      .btn-danger { background: #EF4444; color: white; }
      .btn-primary { background: var(--blue); color: white; }
      .tabs { display: flex; gap: 20px; margin-bottom: 20px; border-bottom: 1px solid #E5E7EB; }
      .tab { padding: 10px 0; cursor: pointer; font-weight: 600; color: var(--text-light); border-bottom: 2px solid transparent; }
      .tab.active { color: var(--blue); border-bottom-color: var(--blue); }
      .hidden { display: none; }
      
      .footer {
        text-align: center; margin-top: 40px; color: #9CA3AF; font-size: 13px;
        border-top: 1px solid #E5E7EB; padding-top: 20px;
      }
      .footer a { color: #6B7280; text-decoration: none; margin: 0 5px; }
      .footer a:hover { color: var(--blue); }
    </style>
  </head>
  <body>
    <div class="tabs">
      <div class="tab active" onclick="switchTab('dashboard', this)">仪表盘</div>
      <div class="tab" onclick="switchTab('gallery', this)">媒体库 (${stats.fileCount})</div>
    </div>

    <div id="view-dashboard">
      <div class="header-grid">
        <div class="card bg-blue">
          <div class="card-title text-blue">总请求数 (7天)</div>
          <div class="card-value text-blue">${stats.recentRequests.toLocaleString()}</div>
          <div class="card-sub text-blue">抽样估算值</div>
        </div>
        <div class="card bg-green">
          <div class="card-title text-green">带宽使用 (7天)</div>
          <div class="card-value text-green">${formatBytes(stats.recentBandwidth)}</div>
          <div class="card-sub text-green">抽样估算值</div>
        </div>
        <div class="card bg-purple">
          <div class="card-title text-purple">总存储占用</div>
          <div class="card-value text-purple">${formatBytes(stats.totalSize)}</div>
          <div class="card-sub text-purple">共 ${stats.fileCount} 个文件</div>
        </div>
        <div class="card" style="background: #FEF2F2;">
          <div class="card-title" style="color: #B91C1C;">总访问量</div>
          <div class="card-value" style="color: #7F1D1D;">${stats.totalViews.toLocaleString()}</div>
          <div class="card-sub" style="color: #991B1B;">抽样估算值</div>
        </div>
      </div>

      <h3>每日流量统计</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>请求数 (估算)</th>
            <th>带宽消耗 (估算)</th>
            <th>访客数 (估算)</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          ${stats.dailyLogs.map(log => `
            <tr>
              <td>${log.date}</td>
              <td>${log.requests}</td>
              <td>${formatBytes(log.bandwidth)}</td>
              <td>${log.visitors}</td>
              <td><span class="tag tag-success">正常</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div id="view-gallery" class="hidden">
        <div class="action-bar">
            <button class="btn btn-primary" onclick="selectAll()">全选</button>
            <button class="btn btn-danger" onclick="deleteSelected()">删除选中</button>
        </div>
        <div class="gallery-grid">
            ${mediaData.map(item => `
                <div class="media-item" data-url="${item.url}" onclick="toggleSelect(this)">
                    ${item.url.match(/\.(mp4|webm)$/i) ? 
                        `<video src="${item.url}" muted></video>` : 
                        `<img loading="lazy" src="${item.url}">`
                    }
                </div>
            `).join('')}
        </div>
    </div>

    <div class="footer">
      <p>
        <i class="fas fa-chart-line"></i> 仪表盘数据为抽样估算值 | 
        <a href="/">返回首页</a>
      </p>
      <p>
        Maintain by <a href="https://github.com/wobushilixi" target="_blank">wobushilixi</a> 
        <span style="margin:0 10px">|</span>
        Based on <a href="https://github.com/0-RTT/telegraph" target="_blank">0-RTT/telegraph</a>
      </p>
    </div>

    <script>
      function switchTab(view, el) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        el.classList.add('active');
        document.getElementById('view-dashboard').classList.add('hidden');
        document.getElementById('view-gallery').classList.add('hidden');
        document.getElementById('view-' + view).classList.remove('hidden');
      }

      let selectedUrls = new Set();
      function toggleSelect(el) {
        el.classList.toggle('selected');
        const url = el.dataset.url;
        if(selectedUrls.has(url)) selectedUrls.delete(url);
        else selectedUrls.add(url);
      }

      function selectAll() {
        document.querySelectorAll('.media-item').forEach(el => {
            el.classList.add('selected');
            selectedUrls.add(el.dataset.url);
        });
      }

      async function deleteSelected() {
        if(selectedUrls.size === 0) return alert('未选择文件');
        if(!confirm('确定删除这 ' + selectedUrls.size + ' 个文件吗？')) return;
        
        const res = await fetch('/delete-images', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(Array.from(selectedUrls))
        });
        if(res.ok) location.reload();
        else alert('删除失败');
      }

      function formatBytes(bytes, decimals = 2) {
          if (!+bytes) return '0 B';
          const k = 1024;
          const dm = decimals < 0 ? 0 : decimals;
          const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return \`\${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} \${sizes[i]}\`;
      }
    </script>
  </body>
  </html>
  `;
}
