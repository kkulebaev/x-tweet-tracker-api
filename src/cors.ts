import type express from 'express';

export function allowCorsAll(): express.RequestHandler {
  return (req, res, next) => {
    // NOTE: This intentionally disables CORS protections.
    // Only do this if you understand the security implications.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}
