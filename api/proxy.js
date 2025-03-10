import { handler } from '../proxyCore'

export default async (req, res) => {
    const result = await handler({
        path: req.url.replace('/api/', '/proxy/'),
        httpMethod: req.method
    })
    
    res.status(result.statusCode)
    Object.entries(result.headers || {}).forEach(([k, v]) => res.setHeader(k, v))
    res.send(result.body)
}