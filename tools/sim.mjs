// The combat simulator from the command line: serves the game, opens it in headless
// Chromium (with ?dev, which loads js/hc/dev/Simulate.js), runs hc.simulate and prints a
// table. Usage:
//     npm run sim -- [--map caverns] [--level 1] [--tiers 0,3,5 | --groups goblin,goblin_pair]
//                    [--fights 200] [--distance 4] [--max-turns 100] [--seed 1]
//                    [--rule name=formula ...] [--json]
// e.g. npm run sim -- --level 2 --groups goblin,goblin_pair,goblin_trio --rule "hitMax=90"
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    PORT = 8767,
    
    // The options from the arguments, as hc.simulate takes them
    parseArgs = args => {
        const opts = {rules:{}}, list = s => s.split(',').map(v => v.trim()).filter(Boolean);
        let json = false;
        for (let i = 0; i < args.length; i++) {
            const arg = args[i], next = () => {
                if (i + 1 >= args.length) throw new Error(arg + ' needs a value');
                return args[++i];
            };
            switch (arg) {
                case '--map': opts.map = next(); break;
                case '--level': opts.level = Number(next()); break;
                case '--tiers': opts.tiers = list(next()).map(Number); break;
                case '--groups': opts.groups = list(next()); break;
                case '--fights': opts.fights = Number(next()); break;
                case '--distance': opts.distance = Number(next()); break;
                case '--max-turns': opts.maxTurns = Number(next()); break;
                case '--seed': opts.seed = Number(next()); break;
                case '--rule': {
                    const [id, ...rest] = next().split('='), value = rest.join('=');
                    opts.rules[id.trim()] = /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : value.trim();
                    break;
                }
                case '--json': json = true; break;
                default: throw new Error('Unknown argument ' + arg);
            }
        }
        return {opts, json};
    },
    
    // The rows as a table, columns padded
    table = rows => {
        const cols = [
                ['', r => r.name], ['fights', r => r.fights], ['win %', r => r.winRate], ['lost', r => r.losses],
                ['timeout', r => r.timeouts], ['turns', r => r.turns], ['HP left', r => r.hpLeft + ' (' + r.hpLeftPct + '%)'],
                ['dealt', r => r.dealt], ['taken', r => r.taken], ['hit %', r => r.hits], ['their hit %', r => r.theirHits],
                ['groups', r => Object.entries(r.groups).map(([id, n]) => id + ' ' + n).join(', ')]
            ],
            cells = [cols.map(([h]) => h), ...rows.map(r => cols.map(([, f]) => String(f(r))))],
            widths = cols.map((_, c) => Math.max(...cells.map(row => row[c].length)));
        return cells.map(row => row.map((v, c) => c === row.length - 1 ? v : v.padEnd(widths[c])).join('  ')).join('\n');
    };

const {opts, json} = parseArgs(process.argv.slice(2)),
    server = spawn(process.execPath, [path.join(ROOT, 'tests/server.mjs'), String(PORT)], {stdio:['ignore', 'pipe', 'inherit']});
await new Promise(resolve => server.stdout.once('data', resolve));
const browser = await chromium.launch();
try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.error('Page error:', err.message));
    await page.goto('http://localhost:' + PORT + '/index.html?dev');
    await page.waitForFunction(() => typeof window.hc?.simulate === 'function');
    const rows = await page.evaluate(opts => new Promise((resolve, reject) => {
        try {
            hc.simulate(opts, resolve);
        } catch (err) {
            reject(err);
        }
    }), opts);
    const {map = 'caverns', level = 1} = opts;
    console.log(json ? JSON.stringify(rows, null, 2) :
        'Map ' + map + ', hero level ' + level + (Object.keys(opts.rules).length ? ', rules ' + JSON.stringify(opts.rules) : '') +
        ' (a simple bot plays the hero: see js/hc/dev/Simulate.js)\n\n' + table(rows));
} finally {
    await browser.close();
    server.kill();
}
