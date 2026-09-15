import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import { installAudioMocks, MockAudioContext, response } from './audioMocks';

vi.mock('@vercel/speed-insights/react', () => ({ SpeedInsights: () => null }));
let requests: ReturnType<typeof installAudioMocks>;
let clipboard: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('tr_smooth_play', 'false');
  requests = installAudioMocks();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  URL.createObjectURL = vi.fn(() => 'blob:local-audio');
  URL.revokeObjectURL = vi.fn();
  clipboard = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboard }, configurable: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function selectLocal() {
  fireEvent.click(screen.getByRole('button', { name: 'Open local audio file for Layer 1 — Far' }));
  await act(async () => {
    fireEvent.change(document.querySelector('input[type=file]')!, {
      target: { files: [new File(['audio'], 'My layer.wav', { type: 'audio/wav' })] },
    });
  });
  await act(async () => { requests.forEach(r => r.result.resolve(response())); });
}

it('imports a local file, retains its filename through compact mode and clears the playing source', async () => {
  render(<App />, { reactStrictMode: true });
  await selectLocal();
  expect(screen.getAllByText('My layer.wav')).toHaveLength(2);
  expect(JSON.parse(localStorage.getItem('tr_audioUrls')!).l1).toBe('');
  fireEvent.keyDown(document.body, { code: 'KeyM', ctrlKey: true });
  expect(screen.queryByRole('button', { name: 'Open local audio file for Layer 1 — Far' })).toBeNull();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTitle(/Expand\s+\(Ctrl\+M\)/));
  expect(screen.getAllByText('My layer.wav')).toHaveLength(2);
  await act(async () => { fireEvent.click(screen.getByTitle(/Play \/ Pause/)); });
  const source = MockAudioContext.instances.at(-1)!.sources[0];
  expect(source.start).toHaveBeenCalledOnce();
  await act(async () => { fireEvent.click(screen.getByTitle('Remove local file')); });
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:local-audio');
  expect(source.stop).toHaveBeenCalledOnce();
});

it('exports no temporary audio reference and the import textarea does not trigger playback shortcuts', async () => {
  render(<App />);
  await selectLocal();
  fireEvent.click(screen.getByTitle('Settings'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Export JSON' })); });
  const exported = JSON.parse(clipboard.mock.calls[0][0]);
  expect(exported.localFilesOmitted).toBe(true);
  expect(exported.urls.l1).toBe('');
  expect(exported.masterVolume).toBe(1);
  expect(exported.alwaysOnTop).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Import JSON' }));
  const textarea = screen.getByPlaceholderText(/Paste exported JSON/);
  fireEvent.keyDown(textarea, { code: 'Space' });
  fireEvent.keyDown(textarea, { code: 'ArrowRight' });
  expect(MockAudioContext.instances.at(-1)!.sources).toHaveLength(0);
  expect(screen.getByText('Safe')).toBeTruthy();
});

it('retains No Virus from the base branch', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: 'No Virus' })).toBeTruthy();
  expect(screen.queryByText('Nil.Incident')).toBeNull();
});
