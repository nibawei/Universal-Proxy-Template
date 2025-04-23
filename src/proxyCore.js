const fetchPromise = import('node-fetch').then(mod => mod.default);

// 允许转发的请求头（按需添加）
const ALLOWED_HEADERS = [
  'content-type',
  'authorization',
  'user-agent',
  'x-requested-with'
];

// 要过滤的请求头（如不转发 AWS 特定头）
const FILTERED_HEADERS = [
  'host',
  'connection',
  'via',
  'x-forwarded-for',
  'x-amz-cf-id'
];

// 重定向规则配置（可根据需要修改）
const REDIRECT_RULES = {
  // 示例：将旧路径重定向到新路径
  '/old-path': '/new-path',
  // 示例：带通配符的重定向
  '/blog/*': '/news/*'
};

// 检查并应用重定向规则
function applyRedirectRules(url) {
  const parsedUrl = new URL(url);
  let path = parsedUrl.pathname;
  
  // 检查完全匹配的重定向
  if (REDIRECT_RULES[path]) {
    parsedUrl.pathname = REDIRECT_RULES[path];
    return parsedUrl.toString();
  }
  
  // 检查通配符重定向
  for (const [pattern, replacement] of Object.entries(REDIRECT_RULES)) {
    if (pattern.endsWith('*')) {
      const basePattern = pattern.slice(0, -1);
      if (path.startsWith(basePattern)) {
        const remainingPath = path.slice(basePattern.length);
        parsedUrl.pathname = replacement.slice(0, -1) + remainingPath;
        return parsedUrl.toString();
      }
    }
  }
  
  return url;
}

module.exports.handler = async (event) => {
  // 处理 OPTIONS 预检请求
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': '*', // 允许所有方法
        'Access-Control-Allow-Headers': ALLOWED_HEADERS.join(', '),
        'Access-Control-Max-Age': '86400'
      },
      body: ''
    };
  }

  const fetch = await fetchPromise;

  // 解析目标 URL
  const path = event.path.replace(/^\/proxy\//, '');
  let targetUrl = decodeURIComponent(path);
  
  // 应用重定向规则
  targetUrl = applyRedirectRules(targetUrl);

  try {
    // 构造请求头
    const headers = {};
    for (const [key, value] of Object.entries(event.headers)) {
      const lowerKey = key.toLowerCase();
      if (
        ALLOWED_HEADERS.includes(lowerKey) &&
        !FILTERED_HEADERS.includes(lowerKey)
      ) {
        headers[lowerKey] = value;
      }
    }

    // 处理请求体
    let body = null;
    if (event.body) {
      body = event.isBase64Encoded ?
        Buffer.from(event.body, 'base64') :
        event.body;
    }

    // 发起代理请求
    const response = await fetch(targetUrl, {
      method: event.httpMethod,
      headers: headers,
      body: body,
      redirect: 'manual' // 改为手动处理重定向
    });

    // 处理重定向响应 (3xx状态码)
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (location) {
        return {
          statusCode: response.status,
          headers: {
            'location': location,
            'cache-control': 'no-cache',
            'access-control-allow-origin': '*'
          },
          body: ''
        };
      }
    }

    // 处理正常响应
    const buffer = await response.arrayBuffer();
    const responseHeaders = {
      'content-type': response.headers.get('content-type'),
      'cache-control': 'public, max-age=86400',
      'access-control-allow-origin': '*' // 强制跨域
    };

    // 保留目标服务器的 CORS 头（可选）
    const corsHeader = response.headers.get('access-control-allow-origin');
    if (corsHeader) {
      responseHeaders['access-control-allow-origin'] = corsHeader;
    }

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body: Buffer.from(buffer).toString('base64'),
      isBase64Encoded: true
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*'
      },
      body: JSON.stringify({
        error: error.message || "Proxy request failed"
      })
    };
  }
};