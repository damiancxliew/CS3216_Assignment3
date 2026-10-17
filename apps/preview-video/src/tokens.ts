import {staticFile} from 'remotion';

export const C = {
  paper: '#fff8e9',
  surface: '#fffdf8',
  ink: '#172033',
  muted: '#5c6472',
  line: '#ded3c1',
  lineStrong: '#9e927e',
  record: '#3659cf',
  recordWash: '#e7ecff',
  world: '#258663',
  signal: '#d85f35',
  danger: '#b82e3e',
  sunshine: '#ffe66d',
};

export const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
export const SANS = 'system-ui, -apple-system, sans-serif';

export const HARD_SHADOW = `4px 4px 0 ${C.ink}`;

/** "/game/foo.png" -> staticFile("game/foo.png") */
export const asset = (path: string) => staticFile(path.replace(/^\//, ''));

export const GAME = '/game/ninja';
