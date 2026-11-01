import { memo, useEffect, useRef } from 'react';
import { CaseSensitive, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { fillLabel } from '../core/format';
import type { PreviewLabels } from '../types';
import type { PaneController } from '../hooks/usePaneController';
import { IconButton } from './IconButton';

/** Unified search bar shared by every searchable renderer. */
export const SearchBar = memo(function SearchBar({
  controller: c,
  labels,
  autoFocus = true,
}: {
  controller: PaneController;
  labels: PreviewLabels;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { search, actions } = c;
  useEffect(() => {
    if (search.open && autoFocus) inputRef.current?.focus();
  }, [search.open, autoFocus]);
  if (!search.open) return null;

  const pending = search.input.trim() !== search.query.trim();
  const status = !search.input.trim()
    ? ''
    : pending
      ? labels.searching
      : search.count === 0
        ? labels.noResults
        : fillLabel(labels.matchOf, {
            current: (search.activeIndex + 1).toLocaleString(),
            total:
              search.count >= 10_000
                ? `${(10_000).toLocaleString()}+`
                : search.count.toLocaleString(),
          });

  return (
    <div className="dsc-searchbar" role="search">
      <Search size={16} aria-hidden="true" className="dsc-searchbar-icon" />
      <input
        ref={inputRef}
        type="search"
        className="dsc-search-input"
        placeholder={labels.searchPlaceholder}
        aria-label={labels.searchPlaceholder}
        value={search.input}
        onChange={(e) => actions.setSearchInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) actions.prevMatch();
            else actions.nextMatch();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (search.input) actions.clearSearch();
            else actions.closeSearch();
          }
        }}
      />
      <span className="dsc-search-count" aria-live="polite" role="status">
        {status}
      </span>
      <IconButton
        label={labels.matchCase}
        icon={<CaseSensitive size={18} />}
        pressed={search.caseSensitive}
        onClick={actions.toggleCaseSensitive}
      />
      <IconButton
        label={labels.previousMatch}
        icon={<ChevronUp size={18} />}
        onClick={actions.prevMatch}
        disabled={search.count === 0}
        shortcut="Shift+Enter"
      />
      <IconButton
        label={labels.nextMatch}
        icon={<ChevronDown size={18} />}
        onClick={actions.nextMatch}
        disabled={search.count === 0}
        shortcut="Enter"
      />
      <IconButton
        label={labels.clearSearch}
        icon={<X size={18} />}
        onClick={() => {
          actions.clearSearch();
          actions.closeSearch();
        }}
      />
    </div>
  );
});
