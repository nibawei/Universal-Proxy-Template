export async function handler(event) {
    const path = event.path.replace(/^\/proxy\//, '')
    const targetUrl = decodeURIComponent(path)
    
    try {
        const response = await fetch(targetUrl)
        
        return {
            statusCode: response.status,
            headers: {
                'content-type': response.headers.get('content-type'),
                'cache-control': 'public, max-age=86400'
            },
            body: await response.buffer()
        }
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        }
    }
}