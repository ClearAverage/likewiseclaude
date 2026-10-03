// Privacy / terms pages: just motion + clickjacking guard.
import { frameGuard } from './ui.js';
import { initMotion } from './motion.js';

if (!frameGuard()) initMotion({ cursor: true });
