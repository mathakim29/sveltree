<script lang="ts" module>
  let count = 0;
  export type DropPosition = 'before' | 'after' | 'inside';
  export interface Leaf {
    label: string;
    id?: string | number;
    parent?: string | number;
    html?: boolean;
    opened?: boolean;
    selectable?: boolean;
  }
</script>

<script lang="ts">
  import { tick } from 'svelte';

  const uid = `vtree-${++count}`;

  interface Props {
    leaves?: Leaf[];
    selected?: string | null;
    theme?: 'light' | 'dark' | 'auto';
    placeholder?: string;
    onrightclick?: (id: string, e: MouseEvent | KeyboardEvent) => void;
    /** Render-only drag: enables dragging and the drop indicator; moving leaves is up to the parent. */
    draggable?: boolean;
    ondragstart?: (id: string, e: DragEvent) => void;
    ondragend?: (id: string, e: DragEvent) => void;
    /** `position`: `before`/`after` the target leaf, or `inside` it as a child. */
    ondrop?: (drop: { id: string; target: string; position: DropPosition }) => void;
    onselect?: (id: string) => void;
    onopen?: (id: string) => void;
    onclose?: (id: string) => void;
  }

  let {
    leaves = [],
    selected = $bindable(null),
    theme = 'light',
    placeholder,
    onrightclick,
    draggable = false,
    ondragstart,
    ondragend,
    ondrop,
    onselect,
    onopen,
    onclose
  }: Props = $props();

  type N = { id: string; parent: string; leaf: Leaf };

  // normalized flat list
  const nodes = $derived<N[]>(
    leaves.map((leaf, i) => ({
      id: leaf.id == null || leaf.id === '' ? `vtree-${i + 1}` : String(leaf.id),
      parent: leaf.parent == null ? '' : String(leaf.parent),
      leaf
    }))
  );
  const byId = $derived(new Map(nodes.map((n) => [n.id, n])));
  const kids = $derived.by(() => {
    const m = new Map<string, N[]>();
    for (const n of nodes) {
      const p = byId.has(n.parent) ? n.parent : '';
      if (!m.has(p)) m.set(p, []);
      m.get(p)!.push(n);
    }
    return m;
  });

  // open state, seeded from `opened`
  let open = $state<Record<string, boolean>>({});
  let seeded = new Set<string>();
  $effect(() => {
    for (const n of nodes) {
      if (!seeded.has(n.id)) {
        seeded.add(n.id);
        if (n.leaf.opened) open[n.id] = true;
      }
    }
  });

  const hasKids = (id: string) => (kids.get(id)?.length ?? 0) > 0;
  const isOpen = (id: string) => !!open[id];
  const parentOf = (id: string) => {
    const p = byId.get(id)?.parent ?? '';
    return byId.has(p) ? p : null;
  };

  // selected leaf, or any descendant of it
  const inSel = (id: string) => {
    for (let c: string | null = id; c !== null; c = parentOf(c)) if (c === selected) return true;
    return false;
  };

  // visible leaves top to bottom
  const visible = $derived.by(() => {
    const out: string[] = [];
    const walk = (p: string) => {
      for (const n of kids.get(p) ?? []) {
        out.push(n.id);
        if (isOpen(n.id)) walk(n.id);
      }
    };
    walk('');
    return out;
  });

  // roving tabindex: one tabbable leaf, never hidden by a closed parent
  let focusId = $state<string | null>(null);
  const tabbable = $derived.by(() => {
    let id = focusId && byId.has(focusId) ? focusId : selected && byId.has(selected) ? selected : null;
    if (id === null) return visible[0] ?? null;
    let shown = id;
    for (let p = parentOf(id); p !== null; p = parentOf(p)) if (!isOpen(p)) shown = p;
    return shown;
  });

  let treeEl: HTMLUListElement;
  const el = (id: string) =>
    treeEl?.querySelector<HTMLElement>(`li[data-vtree-id="${CSS.escape(id)}"]`) ?? null;
  const focusLeaf = (id: string) => {
    focusId = id;
    tick().then(() => el(id)?.focus());
  };

  function toggle(id: string) {
    if (isOpen(id)) close(id);
    else openLeaf(id);
  }
  function openLeaf(id: string) {
    open[id] = true;
    onopen?.(id);
  }
  function close(id: string) {
    open[id] = false;
    const a = document.activeElement;
    const li = el(id);
    if (li && a !== li && li.contains(a)) focusLeaf(id);
    onclose?.(id);
  }
  function select(id: string) {
    const n = byId.get(id);
    if (!n || n.leaf.selectable === false || selected === id) return;
    selected = id;
    focusId = id;
    onselect?.(id);
  }

  function onclick(e: MouseEvent, n: N, part: 'toggle' | 'label') {
    e.stopPropagation();
    if (part === 'toggle') return toggle(n.id);
    if (n.leaf.selectable === false) {
      if (hasKids(n.id)) toggle(n.id);
    } else select(n.id);
  }

  function onkeydown(e: KeyboardEvent, n: N) {
    if (e.target !== e.currentTarget) return;
    const id = n.id;
    const i = visible.indexOf(id);
    const parent = hasKids(id);
    const opened = parent && isOpen(id);
    const k = e.key;
    if (k === 'ArrowDown') {
      if (i < visible.length - 1) focusLeaf(visible[i + 1]);
    } else if (k === 'ArrowUp') {
      if (i > 0) focusLeaf(visible[i - 1]);
    } else if (k === 'Home') focusLeaf(visible[0]);
    else if (k === 'End') focusLeaf(visible[visible.length - 1]);
    else if (k === 'ArrowRight') {
      if (opened) focusLeaf(visible[i + 1]);
      else if (parent) openLeaf(id);
    } else if (k === 'ArrowLeft') {
      const p = parentOf(id);
      if (opened) close(id);
      else if (p !== null) focusLeaf(p);
    } else if (k === 'Enter' || k === ' ') {
      if (n.leaf.selectable !== false) select(id);
      else if (parent) toggle(id);
    } else if ((k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) && onrightclick) {
      onrightclick(id, e);
    } else return;
    e.preventDefault();
  }

  // right click: handed to the parent, native menu suppressed
  function onctx(e: MouseEvent, n: N) {
    if (!onrightclick) return;
    e.preventDefault();
    e.stopPropagation();
    onrightclick(n.id, e);
  }

  // drag: only shows the indicator and reports; the parent moves the leaves
  let dragId = $state<string | null>(null);
  let drop = $state<{ id: string; pos: DropPosition } | null>(null);

  // `id` is `ancestor` or sits under it
  const within = (id: string, ancestor: string) => {
    for (let c: string | null = id; c !== null; c = parentOf(c)) if (c === ancestor) return true;
    return false;
  };

  function dstart(e: DragEvent, n: N) {
    if (!draggable) return;
    dragId = n.id;
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', n.id);
      e.dataTransfer.effectAllowed = 'move';
    }
    ondragstart?.(n.id, e);
  }

  function dover(e: DragEvent, n: N) {
    if (dragId === null) return;
    if (within(n.id, dragId)) {
      drop = null;
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    drop = { id: n.id, pos: y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside' };
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  function dleave(e: DragEvent, n: N) {
    const to = e.relatedTarget as Node | null;
    if (drop?.id === n.id && !(to && (e.currentTarget as HTMLElement).contains(to))) drop = null;
  }

  function ddrop(e: DragEvent, n: N) {
    if (dragId === null || !drop || drop.id !== n.id) return;
    e.preventDefault();
    e.stopPropagation();
    const info = { id: dragId, target: n.id, position: drop.pos };
    dragId = null;
    drop = null;
    ondrop?.(info);
  }

  function dend(e: DragEvent, n: N) {
    dragId = null;
    drop = null;
    ondragend?.(n.id, e);
  }
</script>

{#snippet branch(parent: string)}
  {#each kids.get(parent) ?? [] as n (n.id)}
    {@const has = hasKids(n.id)}
    {@const opened = has && isOpen(n.id)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <li
      class="vtree-leaf"
      class:closed={!opened}
      class:vtree-has-children={has}
      class:vtree-selected={inSel(n.id)}
      data-vtree-id={n.id}
      role="treeitem"
      tabindex={tabbable === n.id ? 0 : -1}
      aria-selected={n.leaf.selectable === false ? undefined : selected === n.id}
      aria-expanded={has ? opened : undefined}
      aria-labelledby="{uid}-{n.id}"
      onkeydown={(e) => onkeydown(e, n)}
      onfocus={(e) => { if (e.target === e.currentTarget) focusId = n.id; }}
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="vtree-toggle" aria-hidden="true" onclick={(e) => onclick(e, n, 'toggle')}></span>
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <span
        class="vtree-leaf-label"
        class:vtree-draggable={draggable}
        class:vtree-dragging={dragId === n.id}
        class:vtree-drop-before={drop?.id === n.id && drop.pos === 'before'}
        class:vtree-drop-after={drop?.id === n.id && drop.pos === 'after'}
        class:vtree-drop-inside={drop?.id === n.id && drop.pos === 'inside'}
        draggable={draggable}
        ondragstart={(e) => dstart(e, n)}
        ondragover={(e) => dover(e, n)}
        ondragleave={(e) => dleave(e, n)}
        ondrop={(e) => ddrop(e, n)}
        ondragend={(e) => dend(e, n)}
        id="{uid}-{n.id}"
        onclick={(e) => onclick(e, n, 'label')}
        ondblclick={(e) => { e.stopPropagation(); selected = null; }}
        oncontextmenu={(e) => onctx(e, n)}
      >{#if n.leaf.html}{@html n.leaf.label}{:else}{n.leaf.label}{/if}</span>

      {#if has}
        <ul class="vtree-subtree" role="group">
          {@render branch(n.id)}
        </ul>
      {/if}
    </li>
  {/each}
{/snippet}

<ul
  bind:this={treeEl}
  class="vtree"
  class:vtree-dark={theme === 'dark'}
  class:vtree-auto={theme === 'auto'}
  role="tree"
>
  {#if nodes.length === 0 && placeholder}
    <li class="vtree-placeholder" role="none">{placeholder}</li>
  {:else}
    {@render branch('')}
  {/if}
</ul>

<style>
  .vtree {
    --vtree-line: #aaa;
    --vtree-hover-background: #eee;
    --vtree-hover-outline: #ddd;
    --vtree-focus: #666;
    --vtree-box-background: #eee;
    --vtree-box-color: #333;
    --vtree-text: inherit;
    --row: 1.4em;
    --box: 0.7em;
    --indent: 1.15em;
    font-family: 'Fira Code', 'FiraCode Nerd Font', 'FiraCode Nerd Font Mono', monospace;
    font-size: clamp(11px, 0.7rem + 0.25vw, 15px);
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--vtree-text);
  }
  .vtree.vtree-dark {
    --vtree-line: #666;
    --vtree-hover-background: #333;
    --vtree-hover-outline: #444;
    --vtree-focus: #aaa;
    --vtree-box-background: #2a2a2a;
    --vtree-box-color: #ddd;
  }
  @media (prefers-color-scheme: dark) {
    .vtree.vtree-auto {
      --vtree-line: #666;
      --vtree-hover-background: #333;
      --vtree-hover-outline: #444;
      --vtree-focus: #aaa;
      --vtree-box-background: #2a2a2a;
      --vtree-box-color: #ddd;
    }
  }

  .vtree-placeholder {
    list-style: none;
    opacity: 0.6;
    line-height: var(--row);
  }

  .vtree-leaf,
  .vtree-subtree {
    margin: 0;
    padding: 0;
    list-style: none;
    position: relative;
  }
  .vtree-leaf {
    min-height: var(--row);
    line-height: var(--row);
  }
  .vtree-leaf .vtree-leaf {
    margin-left: var(--row);
  }
  .vtree-leaf.closed > .vtree-subtree {
    display: none;
  }

  /* tree lines */
  .vtree-leaf .vtree-leaf::after {
    content: '';
    position: absolute;
    left: calc(var(--row) / -2);
    top: 0;
    bottom: 0;
    border-left: 1px dotted var(--vtree-line);
  }
  .vtree-leaf .vtree-leaf:last-child::after {
    bottom: auto;
    height: calc(var(--row) / 2);
  }
  .vtree-leaf .vtree-leaf::before {
    content: '';
    position: absolute;
    left: calc(var(--row) / -2);
    top: calc(var(--row) / 2);
    width: calc(var(--row) / 2);
    border-top: 1px dotted var(--vtree-line);
  }

  /* leaf nodes: line reaches the indented label */
  .vtree-leaf .vtree-leaf:not(.vtree-has-children)::before {
    width: calc(var(--row) / 2 + var(--indent));
  }

  /* toggle box */
  .vtree-has-children > .vtree-toggle {
    position: absolute;
    left: calc((var(--row) - var(--box)) / 2);
    top: calc((var(--row) - var(--box)) / 2);
    width: var(--box);
    height: var(--box);
    box-sizing: border-box;
    border: 1px solid var(--vtree-line);
    background: var(--vtree-box-background);
    cursor: pointer;
    z-index: 1;
  }
  .vtree-has-children > .vtree-toggle::before,
  .vtree-has-children.closed > .vtree-toggle::after {
    content: '';
    position: absolute;
    background: var(--vtree-box-color);
  }
  .vtree-has-children > .vtree-toggle::before {
    left: 1px;
    right: 1px;
    top: calc(50% - 0.5px);
    height: 1px;
  }
  .vtree-has-children.closed > .vtree-toggle::after {
    top: 1px;
    bottom: 1px;
    left: calc(50% - 0.5px);
    width: 1px;
  }

  /* label */
  .vtree-leaf-label {
    display: inline-block;
    vertical-align: top;
    line-height: var(--row);
    cursor: pointer;
    max-width: 100%;
    margin-left: var(--indent);
    padding: 0 0.2em;
  }
  .vtree-leaf-label:hover {
    background-color: var(--vtree-hover-background);
    outline: 1px solid var(--vtree-hover-outline);
  }
  .vtree-selected > .vtree-leaf-label {
    font-weight: 700;
  }

  /* drag indicator */
  .vtree-dragging {
    opacity: 0.5;
  }
  .vtree-drop-before {
    box-shadow: inset 0 2px 0 var(--vtree-focus);
  }
  .vtree-drop-after {
    box-shadow: inset 0 -2px 0 var(--vtree-focus);
  }
  .vtree-drop-inside {
    outline: 1px dashed var(--vtree-focus);
  }

  /* keyboard focus ring on the label only */
  .vtree-leaf:focus {
    outline: none;
  }
  .vtree-leaf:focus-visible > .vtree-leaf-label {
    outline: 2px solid var(--vtree-focus);
    outline-offset: 1px;
  }
</style>