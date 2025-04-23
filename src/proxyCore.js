const fetchPromise = import('node-fetch').then(mod => mod.default);

// 扩展允许转发的请求头
const ALLOWED_HEADERS = [
  'content-type',
  'authorization',
  'user-agent',
  'x-requested-with',
  'accept',
  'accept-language',
  'referer',
  'content-length',
  'range'
];

// 要过滤的请求头
const FILTERED_HEADERS = [
  'host',
  'connection',
  'via',
  'x-forwarded-for',
  'x-amz-cf-id'
];

// 重定向配置
const REDIRECT_OPTIONS = {
  follow: 5, // 最大重定向次数
  redirect: 'manual' // 手动处理重定向以获取更多控制
};

module.exports.handler = async (event) => {
  // 处理 OPTIONS 预检请求
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': ALLOWED_HEADERS.join(', '),
        'Access-Control-Max-Age': '86400',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Location'
      },
      body: ''
    };
  }

  const fetch = await fetchPromise;
  const path = event.path.replace(/^\/proxy\//, '');
  const targetUrl = decodeURIComponent(path);

  try {
    // 构造请求头
    const headers = {};
    for (const [key, value] of Object.entries(event.headers)) {
      const lowerKey = key.toLowerCase();
      if (ALLOWED_HEADERS.includes(lowerKey) && !FILTERED_HEADERS.includes(lowerKey)) {
        headers[lowerKey] = value;
      }
    }

    // 处理请求体
    let body = null;
    if (event.body) {
      body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
    }

    // 发起请求并处理重定向
    let response = await fetch(targetUrl, {
      method: event.httpMethod,
      headers: headers,
      body: body,
      ...REDIRECT_OPTIONS
    });

    // 处理重定向响应
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('Redirect location header missing');
      }

      // 检查重定向次数
      const redirectCount = parseInt(event.headers['x-redirect-count'] || '0', 10);
      if (redirectCount >= REDIRECT_OPTIONS.follow) {
        throw new Error(`Maximum redirects reached (${REDIRECT_OPTIONS.follow})`);
      }

      // 构造新的请求头（携带重定向计数）
      const newHeaders = {
        ...headers,
        'x-redirect-count': (redirectCount + 1).toString()
      };

      // 对于POST等方法的特殊处理
      const method = [301, 302, 303].includes(response.status) ? 'GET' : event.httpMethod;

      // 发起新的请求
      response = await fetch(location, {
        method: method,
        headers: newHeaders,
        body: method === 'GET' ? null : body,
        ...REDIRECT_OPTIONS
      });
    }

    // 处理响应头
    const responseHeaders = {
      'content-type': response.headers.get('content-type'),
      'cache-control': response.headers.get('cache-control') || 'public, max-age=86400',
      'access-control-allow-origin': '*',
      'content-encoding': response.headers.get('content-encoding'),
      'content-length': response.headers.get('content-length')
    };

    // 保留重定向相关的头
    const locationHeader = response.headers.get('location');
    if (locationHeader) {
      responseHeaders['location'] = locationHeader;
    }

    // 保留目标服务器的CORS相关头
    ['access-control-allow-credentials', 'access-control-expose-headers'].forEach(header => {
      const value = response.headers.get(header);
      if (value) responseHeaders[header] = value;
    });

    // 处理二进制响应
    const buffer = await response.arrayBuffer();
    return {
      statusCode: response.status,
      headers: responseHeaders,
      body: Buffer.from(buffer).toString('base64'),
      isBase64Encoded: true
    };

  } catch (error) {
    return {
      statusCode: error.statusCode || 500,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*'
      },
      body: JSON.stringify({
        error: error.message || "Proxy request failed",
        code: error.code || 'PROXY_ERROR',
        ...(error.redirectUrl && { redirectUrl: error.redirectUrl })
      })
    };
  }
};