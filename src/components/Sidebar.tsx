// ============================================================
// Sidebar — drawer lateral de presets (built-in + favoritos)
// ============================================================

import { useState } from 'react';
import { X } from 'lucide-react';
import type { Preset } from '../types';

interface SidebarProps {
  isOpen:    boolean;
  onClose:   () => void;
  builtins:  Preset[];
  favorites: Preset[];
  activeId:  string | null;
  onLoad:    (p: Preset) => void;
  onDelete:  (id: string) => void;
  onSave:    (name: string) => void;
}

export function Sidebar({
  isOpen, onClose, builtins, favorites, activeId, onLoad, onDelete, onSave,
}: SidebarProps) {
  const [saving, setSaving] = useState(false);
  const [name,   setName]   = useState('');

  const submit = () => {
    if (!name.trim()) return;
    onSave(name.trim());
    setName('');
    setSaving(false);
  };

  const PresetRow = ({ preset, deletable }: { preset: Preset; deletable?: boolean }) => (
    <div className={`flex items-center rounded-lg border transition-all ${
      activeId === preset.id
        ? 'bg-red-900/30 border-red-800/60'
        : 'border-transparent hover:bg-neutral-800'
    }`}>
      <button onClick={() => onLoad(preset)}
        className={`flex-1 text-left px-3 py-2.5 text-sm font-bold flex items-center gap-2.5 ${
          activeId === preset.id ? 'text-red-300' : 'text-neutral-400 hover:text-neutral-200'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          activeId === preset.id ? 'bg-red-400' : deletable ? 'bg-yellow-500/60' : 'bg-neutral-600'
        }`} />
        {preset.name}
      </button>
      {deletable && (
        <button onClick={() => onDelete(preset.id)}
          className="pr-3 text-neutral-600 hover:text-red-400 transition-colors text-base leading-none"
          title="Remove"
        >×</button>
      )}
    </div>
  );

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/50 z-30" onClick={onClose} />}

      <aside className={`fixed left-0 top-0 h-screen w-72 bg-neutral-900 border-r border-neutral-800 z-40 flex flex-col transform transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
      }`}>
        <div className="flex items-center justify-between px-4 py-4 border-b border-neutral-800 flex-shrink-0">
          <span className="text-xs font-black uppercase tracking-widest text-neutral-400">Presets</span>
          <button onClick={onClose}
            className="text-neutral-600 hover:text-neutral-200 transition-colors p-1 rounded"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          <p className="text-[10px] text-neutral-600 font-bold uppercase tracking-widest px-2 pt-1 pb-1.5">
            Built-in
          </p>
          {builtins.map(p => <PresetRow key={p.id} preset={p} />)}

          {favorites.length > 0 && (
            <>
              <div className="pt-3 pb-1">
                <div className="border-t border-neutral-800 mb-3" />
                <p className="text-[10px] text-neutral-600 font-bold uppercase tracking-widest px-2">
                  Saved
                </p>
              </div>
              {favorites.map(p => <PresetRow key={p.id} preset={p} deletable />)}
            </>
          )}
        </div>

        <div className="px-3 py-3 border-t border-neutral-800 flex-shrink-0">
          {saving ? (
            <div className="space-y-2">
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submit();
                  if (e.key === 'Escape') { setSaving(false); setName(''); }
                }}
                placeholder="Preset name…"
                className="w-full bg-neutral-950 border border-neutral-700 text-neutral-300 text-xs rounded px-3 py-2 focus:outline-none focus:border-red-700"
              />
              <div className="flex gap-2">
                <button onClick={submit}
                  className="flex-1 text-[10px] font-bold py-1.5 rounded bg-red-900/60 text-red-300 border border-red-700 hover:bg-red-900 transition-colors uppercase tracking-wide"
                >Save</button>
                <button onClick={() => { setSaving(false); setName(''); }}
                  className="text-xs text-neutral-600 hover:text-neutral-400 px-2 transition-colors"
                >Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setSaving(true)}
              className="w-full text-xs font-bold px-3 py-2 rounded-lg border border-dashed border-neutral-700 text-neutral-600 hover:text-neutral-300 hover:border-neutral-500 transition-all"
            >
              + Save current setup
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
