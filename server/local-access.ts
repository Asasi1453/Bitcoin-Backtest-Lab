import type { Request, Response, NextFunction } from 'express';

// Reject cross-site browser requests and DNS rebinding before parsing any API body.
export function localAccess(req: Request, res: Response, next: NextFunction) {
  const hosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  const local = (value: string) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && hosts.has(url.hostname);
    } catch {
      return false;
    }
  };
  if (
    !local('http://' + req.headers.host) ||
    (req.headers.origin !== undefined && !local(req.headers.origin)) ||
    req.headers['sec-fetch-site'] === 'cross-site'
  ) {
    res.status(403).json({ error: 'Bu API yalnızca yerel uygulamadan kullanılabilir.' });
    return;
  }
  next();
}
