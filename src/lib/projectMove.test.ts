import { describe, expect, it } from 'vitest';
import { projectDrop } from './projectMove';
import type { Project } from './types';

const P = (id: string, area_id: string | null, sort: number, completed_at: string | null = null): Project => ({ id, area_id, name: id, notes: '', sort, completed_at });
const projects = [P('a', null, 1), P('b', null, 2), P('x', 'A1', 1), P('y', 'A1', 2), P('z', 'A2', 1), P('done', 'A1', 1.5, '2026-01-01')];
const areas = ['A1', 'A2'];

describe('projectDrop', () => {
  it('moves a loose project into an area, at the end or before a project', () => {
    expect(projectDrop(projects, areas, 'a', { area: 'A1', before: null })).toEqual({ area_id: 'A1', sort: 3 });
    expect(projectDrop(projects, areas, 'a', { area: 'A1', before: 'y' })).toEqual({ area_id: 'A1', sort: 1.5 });
    expect(projectDrop(projects, areas, 'a', { area: 'A2', before: 'z' })).toEqual({ area_id: 'A2', sort: 0 });
  });

  it('moves a project between areas and out of any area', () => {
    expect(projectDrop(projects, areas, 'x', { area: 'A2', before: null })).toEqual({ area_id: 'A2', sort: 2 });
    expect(projectDrop(projects, areas, 'x', { area: null, before: 'b' })).toEqual({ area_id: null, sort: 1.5 });
    expect(projectDrop(projects, areas, 'z', { area: null, before: null })?.area_id).toBeNull();
  });

  it('moves into an empty area or an empty no-area list', () => {
    expect(projectDrop([P('x', 'A1', 5)], ['A1', 'A2'], 'x', { area: 'A2', before: null })).toEqual({ area_id: 'A2', sort: 0 });
    expect(projectDrop([P('x', 'A1', 5)], ['A1'], 'x', { area: null, before: null })).toEqual({ area_id: null, sort: 0 });
  });

  it('reorders within the same list', () => {
    expect(projectDrop(projects, areas, 'b', { area: null, before: 'a' })).toEqual({ area_id: null, sort: 0 });
    expect(projectDrop(projects, areas, 'x', { area: 'A1', before: null })).toEqual({ area_id: 'A1', sort: 3 });
  });

  it('ignores drops that change nothing', () => {
    expect(projectDrop(projects, areas, 'a', { area: null, before: 'a' })).toBeNull();
    expect(projectDrop(projects, areas, 'a', { area: null, before: 'b' })).toBeNull();
    expect(projectDrop(projects, areas, 'y', { area: 'A1', before: null })).toBeNull();
  });

  it('refuses invalid targets', () => {
    expect(projectDrop(projects, areas, 'nope', { area: null, before: null })).toBeNull();
    expect(projectDrop(projects, areas, 'a', { area: 'gone', before: null })).toBeNull();
    expect(projectDrop(projects, areas, 'a', { area: 'A1', before: 'z' })).toBeNull(); // z isn't in A1
    expect(projectDrop(projects, areas, 'done', { area: null, before: null })).toBeNull();
  });
});
