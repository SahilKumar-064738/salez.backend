import pino from 'pino';

const NODE_ENV = process.env.NODE_ENV || 'development';

export const logger = pino({
  level: NODE_ENV === 'production' ? 'info' : 'debug',
  ...(NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    },
  }),
  base: { pid: process.pid, env: NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      '*.key_hash',
      '*.api_token_encrypted',
      '*.password',
    ],
    censor: '[REDACTED]',
  },
});