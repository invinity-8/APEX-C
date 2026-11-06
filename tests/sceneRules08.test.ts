import { describe, expect, it } from 'vitest';
import { emptyMap, parseMap, regionMilesPerHour, type MapNode } from '../src/campaign/maps';
import { movementCost, snappedPoint } from '../src/campaign/sceneMovement';
import { toPixel } from '../src/game/hex';
import { publicMap } from '../src/server/sceneRuntime';
import { decodeMapImage } from '../src/server/sceneAssets';
import { imageDimensions } from '../src/campaign/images';
const node = (patch: Partial<MapNode>): MapNode => ({ id: 'node', kind: 'location', x: 100, y: 100, width: 50, height: 50, label: 'Place', description: '', visible: false, targetScene: null, ...patch });

describe('campaign scales, geometry and redaction', () => {
  it('converts six-second speed to an hour without touching daily Arena MP', () => {
    expect(regionMilesPerHour(30)).toBeCloseTo(3.40909); expect(regionMilesPerHour(30, 2)).toBeCloseTo(1.704545); expect(regionMilesPerHour(-1)).toBe(0);
  });
  it('uses square diagonals and genuine axial hex distances', () => {
    const map = emptyMap('battle');
    expect(movementCost(map, { x: 25, y: 25 }, { x: 75, y: 75 })).toEqual({ ok: true, cost: 5 });
    map.grid = 'hex'; expect(movementCost(map, toPixel({ q: 5, r: 5 }, 25), toPixel({ q: 7, r: 4 }, 25))).toEqual({ ok: true, cost: 10 });
    expect(snappedPoint(emptyMap('battle'), { x: 61, y: 80 })).toEqual({ x: 75, y: 75 });
  });
  it('cannot jump over a one-pixel hidden wall', () => {
    const map = emptyMap('battle'); map.nodes = [node({ kind: 'wall', x: 100, y: 0, width: 1, height: 200 })];
    expect(movementCost(map, { x: 25, y: 25 }, { x: 225, y: 25 })).toEqual({ ok: false, error: 'The path is blocked.' });
  });
  it('charges only the crossed fraction of difficult terrain', () => {
    const map = emptyMap('battle'); map.nodes = [node({ kind: 'area', x: 50, y: 0, width: 100, height: 100, terrainCost: 2 })];
    expect(movementCost(map, { x: 25, y: 25 }, { x: 225, y: 25 })).toEqual({ ok: true, cost: 30 });
  });
  it('never serializes GM notes, hidden nodes/routes or a GM source-image ID', () => {
    const map = emptyMap('world'); map.gmNotes = 'PRIVATE NOTES'; map.backgroundAsset = '00000000-0000-4000-8000-000000000001'; map.playerBackgroundAsset = '00000000-0000-4000-8000-000000000002';
    map.nodes = [node({ id: 'known', visible: true }), node({ id: 'secret', label: 'Hidden dragon' }), node({ id: 'spawn', kind: 'spawn', visible: true })];
    map.routes = [{ id: 'hidden-route', from: 'known', to: 'secret', visible: true, hours: 2, distance: 5 }];
    const output = publicMap(map); const text = JSON.stringify(output);
    expect(text).not.toContain('PRIVATE NOTES'); expect(text).not.toContain(map.backgroundAsset); expect(text).not.toContain('Hidden dragon'); expect(output?.nodes).toHaveLength(1); expect(output?.routes).toHaveLength(0);
  });
  it('rejects duplicate node IDs, dangling routes and nonfinite dimensions', () => {
    const map = emptyMap('world'); expect(parseMap({ ...map, nodes: [node({}), node({})] })).toBeNull();
    expect(parseMap({ ...map, width: Infinity })).toBeNull();
    expect(parseMap({ ...map, routes: [{ id: 'r', from: 'missing', to: 'other', hours: 1, distance: 1, visible: true }] })).toBeNull();
  });
});
describe('map upload boundaries', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==';
  it('accepts a real PNG and rejects MIME spoofing, SVG and over-limit data', () => {
    expect(decodeMapImage(png)).toMatchObject({ mime: 'image/png', width: 1, height: 1 });
    expect(decodeMapImage(png.replace('image/png', 'image/jpeg'))).toBeNull();
    expect(decodeMapImage('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull(); expect(decodeMapImage(png, 10)).toBeNull();
  });
  it('rejects pixel bombs before decoding and safely handles truncated JPEG headers', () => {
    const bytes = Buffer.from(png.split(',')[1], 'base64'); bytes.writeUInt32BE(100000, 16);
    expect(decodeMapImage('data:image/png;base64,' + bytes.toString('base64'))).toBeNull();
    for (let n = 0; n < 40; n++) expect(() => imageDimensions(Uint8Array.from([255,216,...Array(n).fill(255)]), 'image/jpeg')).not.toThrow();
  });
});
