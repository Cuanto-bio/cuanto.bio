import pino from 'pino';

const logger = pino({ name: 'cuanto.bio', browser: { asObject: false } });

export default logger;
