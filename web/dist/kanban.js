let openaiCheckAttempts = 0;
const MAX_OPENAI_CHECKS = 200;
const CHECK_DELAY_MS = 50;
let controlsInitialized = false;
let pending = false;

const STATUS_OPTIONS = [
  { value: 'todo', label: 'To do' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'done', label: 'Done' }
];

function debug(...args) {
  if (typeof console === 'undefined' || !console.log) return;
  const message = args
    .map((part) => {
      if (typeof part === 'string') return part;
      try {
        return JSON.stringify(part);
      } catch (_error) {
        return String(part);
      }
    })
    .join(' ');
  console.log('[kanban]', message);
}

function formatTimestamp(isoString) {
  if (!isoString) return '';
  const timestamp = new Date(isoString);
  if (Number.isNaN(timestamp.getTime())) return '';
  return timestamp.toLocaleString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric'
  });
}

function createTaskElement(task) {
  const li = document.createElement('li');
  li.className = 'kanban-task';

  const title = document.createElement('strong');
  title.textContent = task.title;
  li.appendChild(title);

  const footer = document.createElement('footer');
  footer.textContent = `Assigned to ${task.assignee}`;
  li.appendChild(footer);

  return li;
}

function getRoot() {
  return document.getElementById('kanban-root');
}

function extractStructured(state) {
  if (!state || typeof state !== 'object') return undefined;
  if ('structuredContent' in state && state.structuredContent) {
    return state.structuredContent;
  }
  if ('structured_content' in state && state.structured_content) {
    return state.structured_content;
  }
  return state;
}

function resolveFromMetadata(openai) {
  const metadata = openai.toolResponseMetadata;
  if (!metadata || typeof metadata !== 'object') return undefined;

  if (metadata.structuredContent) {
    return metadata.structuredContent;
  }
  if (metadata.structured_content) {
    return metadata.structured_content;
  }
  if (metadata['structuredContent']) {
    return metadata['structuredContent'];
  }

  const outputs = metadata.toolOutputs || metadata.tool_outputs;
  if (Array.isArray(outputs) && outputs.length) {
    const latest = outputs[outputs.length - 1];
    if (latest) {
      if (latest.structuredContent) return latest.structuredContent;
      if (latest.structured_content) return latest.structured_content;
      if (latest.output) {
        const candidate = extractStructured(latest.output);
        if (candidate) return candidate;
      }
    }
  }

  if (Array.isArray(metadata.columnsFull) && metadata.columnsFull.length) {
    return {
      columns: metadata.columnsFull,
      lastSyncedAt: metadata.lastSyncedAt,
    };
  }

  if (metadata['openai/widgetState']) {
    const state = metadata['openai/widgetState'];
    if (state && typeof state === 'object') {
      return {
        columns: state.columns,
        lastSyncedAt: state.lastSyncedAt,
      };
    }
  }

  return undefined;
}

function setMessage(text, type = 'info') {
  const messageEl = document.querySelector('.kanban-message');
  if (!messageEl) return;
  messageEl.textContent = text;
  messageEl.dataset.type = type;
}

function buildControls(openai) {
  if (controlsInitialized) return;
  const root = getRoot();
  if (!root) return;

  const container = document.createElement('div');
  container.className = 'kanban-controls';

  const form = document.createElement('form');
  form.className = 'kanban-form';
  form.setAttribute('aria-label', 'Add a new task');

  const fields = [
    {
      name: 'title',
      label: 'Task',
      type: 'text',
      placeholder: 'Define onboarding flow',
      required: true,
    },
    {
      name: 'assignee',
      label: 'Assignee',
      type: 'text',
      placeholder: 'Ada Lovelace',
      required: true,
    },
  ];

  fields.forEach((field) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'kanban-field';
    wrapper.textContent = field.label;

    const input = document.createElement('input');
    input.name = field.name;
    input.type = field.type;
    input.placeholder = field.placeholder;
    if (field.required) input.required = true;
    wrapper.appendChild(input);
    form.appendChild(wrapper);
  });

  const statusWrapper = document.createElement('label');
  statusWrapper.className = 'kanban-field';
  statusWrapper.textContent = 'Status';

  const statusSelect = document.createElement('select');
  statusSelect.name = 'status';
  statusSelect.className = 'kanban-status';
  STATUS_OPTIONS.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    statusSelect.appendChild(option);
  });
  statusWrapper.appendChild(statusSelect);
  form.appendChild(statusWrapper);

  const submitButton = document.createElement('button');
  submitButton.type = 'submit';
  submitButton.className = 'kanban-submit';
  submitButton.textContent = 'Add task';
  form.appendChild(submitButton);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void handleSubmit(form, submitButton, openai);
  });

  const refreshButton = document.createElement('button');
  refreshButton.type = 'button';
  refreshButton.className = 'kanban-refresh';
  refreshButton.textContent = 'Refresh board';
  refreshButton.addEventListener('click', () => {
    debug('manual refresh triggered');
    handleInitialRender(openai);
  });

const message = document.createElement('span');
  message.className = 'kanban-message';
  message.textContent = '';

  container.appendChild(form);
  container.appendChild(refreshButton);
  container.appendChild(message);

  root.parentElement?.insertBefore(container, root);
  controlsInitialized = true;
}

async function handleSubmit(form, submitButton, openai) {
  if (pending) return;
  if (!openai || typeof openai.callTool !== 'function') {
    debug('callTool unavailable; cannot add task');
    setMessage('Write access is unavailable in this client.', 'error');
    return;
  }

  const formData = new FormData(form);
  const title = (formData.get('title') || '').toString().trim();
  const assignee = (formData.get('assignee') || '').toString().trim();
  const status = (formData.get('status') || 'todo').toString();

  if (!title || !assignee) {
    setMessage('Please provide both a task and an assignee.', 'error');
    return;
  }

  pending = true;
  submitButton.disabled = true;
  setMessage('Adding task…', 'info');

  try {
    const response = await openai.callTool({
      name: 'kanban-board',
      arguments: {
        newTask: {
          title,
          assignee,
          status,
        },
      },
    });

    debug('callTool response keys', response && Object.keys(response));

    if (response && response.toolOutput) {
      renderBoard(response.toolOutput, openai);
    } else if (response && response.structuredContent) {
      renderBoard({ structuredContent: response.structuredContent }, openai);
    } else {
      setMessage('Task added. Refreshing board…', 'info');
      renderBoard(null, openai);
    }

    form.reset();
    setMessage('Task added successfully.', 'success');
  } catch (error) {
    debug('callTool failed', error);
    setMessage('Failed to add task.', 'error');
  } finally {
    pending = false;
    submitButton.disabled = false;
  }
}

function renderBoard(state, openai) {
  const root = getRoot();
  if (!root) {
    debug('Root missing, retrying render');
    setTimeout(() => renderBoard(state, openai), CHECK_DELAY_MS);
    return;
  }

  buildControls(openai);

  let structured = extractStructured(state) || {};
  const metaFromState = state && typeof state === 'object' && state._meta ? state._meta : undefined;

  if ((!structured.columns || !structured.columns.length) && openai) {
    const fallback = resolveFromMetadata(openai);
    if (fallback && fallback.columns && fallback.columns.length) {
      debug('Using metadata fallback for structured content');
      structured = fallback;
    } else if (openai.widgetState && Array.isArray(openai.widgetState.columns)) {
      debug('Using widgetState columns fallback');
      structured = {
        columns: openai.widgetState.columns,
        lastSyncedAt: openai.widgetState.lastSyncedAt,
      };
    }
  }

  let columns = Array.isArray(structured.columns) ? structured.columns : [];
  if ((!columns || !columns.length) && metaFromState && Array.isArray(metaFromState.columnsFull)) {
    debug('Using _meta.columnsFull fallback');
    columns = metaFromState.columnsFull;
  }

  const metadata = (openai && openai.metadata) || {};
  const lastSyncedAt = structured.lastSyncedAt || metadata.lastSyncedAt;

  root.innerHTML = '';

  debug('resolved columns length', columns.length, 'structured keys', Object.keys(structured || {}));

  if (!columns.length) {
    const empty = document.createElement('p');
    empty.className = 'kanban-empty';
    empty.textContent = 'No tasks available.';
    root.appendChild(empty);
    debug('rendered with zero columns', structured, openai && openai.toolResponseMetadata);
  } else {
    columns.forEach((column) => {
      const section = document.createElement('section');
      section.className = 'kanban-column';

      const heading = document.createElement('h2');
      heading.textContent = `${column.title || 'Column'} (${(column.tasks || []).length})`;
      section.appendChild(heading);

      const list = document.createElement('ul');
      list.setAttribute('role', 'list');

      (column.tasks || []).forEach((taskRef) => {
        const task = taskRef && typeof taskRef === 'object' ? taskRef : undefined;
        if (!task) return;
        list.appendChild(createTaskElement(task));
      });

      section.appendChild(list);
      root.appendChild(section);
    });
  }

  if (lastSyncedAt) {
    const updated = document.createElement('p');
    updated.className = 'kanban-updated';
    updated.textContent = `Last synced ${formatTimestamp(lastSyncedAt)}`;
    root.appendChild(updated);
  }
}

function handleInitialRender(openai) {
  const candidate =
    openai.toolOutput ||
    openai.lastToolResult ||
    openai.latestToolOutput ||
    (Array.isArray(openai.toolOutputs) && openai.toolOutputs.length
      ? openai.toolOutputs[openai.toolOutputs.length - 1]
      : undefined);

  debug('toolOutput raw', openai.toolOutput);
  debug('toolOutputs length', Array.isArray(openai.toolOutputs) ? openai.toolOutputs.length : 'n/a');
  debug('widgetState keys', openai.widgetState && Object.keys(openai.widgetState));
  debug('initial payload keys', candidate && Object.keys(candidate));
  debug('initial payload meta keys', candidate && candidate._meta && Object.keys(candidate._meta));

  renderBoard(candidate, openai);
}

function initialize() {
  const openai = window.openai;

  if (!openai) {
    if (openaiCheckAttempts < MAX_OPENAI_CHECKS) {
      openaiCheckAttempts += 1;
      setTimeout(initialize, CHECK_DELAY_MS);
    } else {
      debug('window.openai unavailable after retries');
    }
    return;
  }

  debug('openai keys', Object.keys(openai));
  debug('toolResponseMetadata keys', openai.toolResponseMetadata && Object.keys(openai.toolResponseMetadata));

  handleInitialRender(openai);

  buildControls(openai);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
