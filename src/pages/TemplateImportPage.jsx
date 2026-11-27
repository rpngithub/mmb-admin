import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  Progress,
  Result,
  Space,
  Spin,
  Steps,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowLeftOutlined,
  CloudUploadOutlined,
  PauseOutlined,
  ReloadOutlined,
  RocketOutlined,
  StopOutlined,
  PauseCircleOutlined,
  FileSearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  useTemplateImportGetQuery,
  useTemplateImportCreateMutation,
  useTemplateImportSendFilesMutation,
  useReplaceTemplateImportManifestMutation,
  useTemplateImportStartMutation,
  useTemplateImportPresignMutation,
  useTemplateImportCompleteMutation,
  useTemplateImportFinalizeMutation,
  useTemplateImportCancelMutation,
  useMultipartInitiateMutation,
  useMultipartPresignPartsMutation,
  useMultipartCompleteMutation,
} from '../features/api/adminApi';
import { usePermissions } from '../features/auth/usePermissions';
import TemplateImportFolderPicker from '../components/TemplateImportFolderPicker';
import TemplateImportReport from '../components/TemplateImportReport';
import { ManifestTemplateLinks } from './TemplateImportsPage';
import { isAbortError } from '../lib/assetUpload';
import {
  IMPORT_STATUS,
  STAGE,
  STAGE_ORDER,
  buildFilesRow,
  bundleNotes,
  canRecheck,
  checkManifest,
  chunkRows,
  countStages,
  createUploadRunner,
  designJsonSize,
  errorText,
  fmtBytes,
  forgetManifest,
  isFileWarning,
  isManifestRejected,
  isUploadable,
  limitsOf,
  manifestRowCount,
  mismatchedRows,
  needsFiles,
  precheckFiles,
  precheckManifest,
  pruneByRows,
  recallFolder,
  recallManifest,
  rememberFolder,
  rememberManifest,
  rowKey,
  withRetry,
} from '../lib/templateImport';

const { Title, Text, Paragraph } = Typography;

const fmt = (v) => (v ? dayjs(v).format('D MMM YYYY, HH:mm') : '—');

// The batch folder's name, so a resume can ask for "the same folder". A
// per-browser convenience only — files are matched by name and size anyway.
const FOLDER_KEY = (uid) => `mmb_tpl_import_folder:${uid}`;
const saveFolderName = (uid, name) => {
  try {
    if (name) localStorage.setItem(FOLDER_KEY(uid), name);
  } catch {
    /* storage unavailable */
  }
};
const loadFolderName = (uid) => {
  try {
    return localStorage.getItem(FOLDER_KEY(uid)) || null;
  } catch {
    return null;
  }
};

/** Inline API error: message + details[] (field: message). */
function ApiError({ error, onClose }) {
  if (!error) return null;
  const details = Array.isArray(error.details) ? error.details : [];
  return (
    <Alert
      type="error"
      showIcon
      closable={Boolean(onClose)}
      onClose={onClose}
      message={errorText(error)}
      description={
        details.length > 1 || (details.length === 1 && details[0].field) ? (
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {details.map((d, i) => (
              <li key={i}>
                {d.field ? <Text code>{d.field}</Text> : null} {d.message}
              </li>
            ))}
          </ul>
        ) : undefined
      }
    />
  );
}

function Problems({ problems }) {
  if (!problems?.length) return null;
  return (
    <Alert
      type="error"
      showIcon
      message="Fix these before continuing"
      description={
        <ul style={{ margin: 0, paddingInlineStart: 18 }}>
          {problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      }
    />
  );
}

// The layout the design team prepares — shown on the pick-folder step.
const FOLDER_EXAMPLE = `diwali-batch/
  manifest.csv
  diwali-sale-01-en-square.zip
  diwali-sale-01-hi-square.zip
  pongal-offer-02-en-square.zip

Each ZIP:
  template.json       exactly one .json in the root, any name
  thumbnail.jpg       .png / .jpg / .jpeg / .webp
  assets/             everything else (Lottie .json, videos, fonts)`;

function FolderStructure() {
  return (
    <div>
      <Text strong>Folder structure</Text>
      <pre
        style={{
          margin: '6px 0 4px',
          padding: '10px 14px',
          background: 'rgba(0,0,0,0.03)',
          border: '1px solid rgba(0,0,0,0.06)',
          borderRadius: 6,
          fontSize: 13,
          lineHeight: 1.6,
          overflowX: 'auto',
        }}
      >
        {FOLDER_EXAMPLE}
      </pre>
      <Text type="secondary" style={{ fontSize: 12 }}>
        One manifest row per version; <Text code>folder</Text> is the ZIP’s path relative to manifest.csv (e.g.{' '}
        <Text code>diwali-sale-01-en-square.zip</Text> or <Text code>diwali/en.zip</Text>). Use the ZIPs exactly as
        exported; rows are grouped into designs by <Text code>family_name</Text> only. The design refers to its files
        by bare file name, and every file name in a ZIP must be unique. Unzipped folders also work — give the folder’s
        path — and one batch may mix both. Leave <Text code>thumbnail</Text> blank to use the bundle’s thumbnail.*
        image.
      </Text>
    </div>
  );
}

const STEP_OF = { draft: 1, validated: 2, running: 3, completed: 4, completed_with_issues: 4 };

export default function TemplateImportPage() {
  const { uid } = useParams();
  const isNew = uid === 'new';
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const perms = usePermissions();
  const canWrite = perms.can('templates', 'create');

  const {
    data: report,
    isLoading,
    error: loadError,
    refetch,
    isFetching,
  } = useTemplateImportGetQuery(uid, { skip: isNew });

  const [createImport] = useTemplateImportCreateMutation();
  const [sendFiles] = useTemplateImportSendFilesMutation();
  const [replaceManifest] = useReplaceTemplateImportManifestMutation();
  const [startImport] = useTemplateImportStartMutation();
  const [presign] = useTemplateImportPresignMutation();
  const [completeRow] = useTemplateImportCompleteMutation();
  const [finalizeImport] = useTemplateImportFinalizeMutation();
  const [cancelImport] = useTemplateImportCancelMutation();
  const [initiate] = useMultipartInitiateMutation();
  const [presignParts] = useMultipartPresignPartsMutation();
  const [multipartComplete] = useMultipartCompleteMutation();

  // ---- local state ----------------------------------------------------------
  const [folder, setFolder] = useState(() => (isNew ? null : recallFolder(uid)));
  const folderRef = useRef(folder);
  folderRef.current = folder;
  const [label, setLabel] = useState('');
  // idle | creating | reading | replacing | sending | starting | uploading | finalizing | cancelling
  const [phase, setPhase] = useState('idle');
  // manifest.csv on disk vs the text last sent: { state: unchanged | changed | unknown | unreadable }
  const [manifestCheck, setManifestCheck] = useState(null);
  // A re-check waiting for the folder to be picked again ('awaiting' | 'all').
  const pendingRecheckRef = useRef(null);
  // A 409 from PUT …/manifest: the import has moved on.
  const [conflict, setConflict] = useState(null);
  const [problems, setProblems] = useState([]);
  const [apiError, setApiError] = useState(null);
  const [sendProgress, setSendProgress] = useState(null);
  const [readProgress, setReadProgress] = useState(null);
  const readAbortRef = useRef(null);
  const [mismatch, setMismatch] = useState([]);
  const [showRepick, setShowRepick] = useState(false);

  // Upload runner state: a mutable map flushed to React a few times a second.
  const runRef = useRef(new Map());
  const [run, setRun] = useState(() => new Map());
  const dirtyRef = useRef(false);
  const runnerRef = useRef(null);
  const sessionsRef = useRef(new Map());
  const aliveRef = useRef(true);

  const flush = useCallback(() => {
    dirtyRef.current = false;
    setRun(new Map(runRef.current));
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      readAbortRef.current?.abort();
      runnerRef.current?.stop();
      runnerRef.current = null;
    };
  }, []);

  // new → real uid keeps the same component; pick up a remembered folder.
  useEffect(() => {
    if (isNew) return;
    const remembered = recallFolder(uid);
    if (remembered && remembered !== folderRef.current) setFolder(remembered);
  }, [uid, isNew]);

  useEffect(() => {
    if (phase !== 'uploading') return undefined;
    const t = setInterval(() => {
      if (dirtyRef.current) flush();
    }, 300);
    return () => clearInterval(t);
  }, [phase, flush]);

  // Leaving the page while files go up pauses the import.
  useEffect(() => {
    if (phase !== 'uploading' && phase !== 'sending') return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = 'Uploads in progress will pause.';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [phase]);

  const items = useMemo(() => report?.items || [], [report]);
  const counts = useMemo(() => countStages(items), [items]);
  const limits = limitsOf(report);
  const expectName = isNew ? null : loadFolderName(uid);
  const status = report?.status;
  // manifest.csv can be replaced only before Start.
  const editable = status === 'draft' || status === 'validated';
  const reportRef = useRef(report);
  reportRef.current = report;

  // Compare manifest.csv on disk with the text last sent (the button label
  // depends on it). Re-run on every pick and when the tab gets focus back —
  // the admin usually edits the file in another app.
  const refreshManifestCheck = useCallback(async () => {
    const index = folderRef.current;
    if (!index || isNew) {
      setManifestCheck(null);
      return null;
    }
    const res = await checkManifest(index, recallManifest(uid, reportRef.current));
    if (aliveRef.current && folderRef.current === index) setManifestCheck(res);
    return res;
  }, [uid, isNew]);

  useEffect(() => {
    if (!editable || !folder) {
      setManifestCheck(null);
      return;
    }
    refreshManifestCheck();
  }, [editable, folder, refreshManifestCheck]);

  useEffect(() => {
    if (!editable || !folder || phase !== 'idle') return undefined;
    const onFocus = () => refreshManifestCheck();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [editable, folder, phase, refreshManifestCheck]);

  // Reading ZIPs takes a while: every reader gets a signal (Stop, unmount) and
  // reports "Reading x / y ZIPs".
  const newReadOpts = useCallback(() => {
    readAbortRef.current?.abort();
    const controller = new AbortController();
    readAbortRef.current = controller;
    return {
      signal: controller.signal,
      onProgress: (done, total) => {
        if (aliveRef.current && !controller.signal.aborted) {
          setReadProgress(done < total ? { done, total } : null);
        }
      },
    };
  }, []);
  const stopReading = () => readAbortRef.current?.abort();

  const pickFolder = async (index) => {
    folderRef.current = index;
    setFolder(index);
    setProblems([]);
    setMismatch([]);
    if (isNew) return;
    rememberFolder(uid, index);
    saveFolderName(uid, index.rootName);
    // Picked again because manifest.csv could not be read: carry on with the check.
    if (pendingRecheckRef.current && editable) {
      const mode = pendingRecheckRef.current;
      pendingRecheckRef.current = null;
      // eslint-disable-next-line no-use-before-define
      await recheck(mode);
      return;
    }
    if (!items.some(isUploadable)) return;
    setPhase('reading');
    try {
      const bad = await mismatchedRows(index, items, newReadOpts());
      if (aliveRef.current) setMismatch(bad);
    } catch (err) {
      // Stopped: the upload checks the files again before it starts.
      if (!isAbortError(err) && aliveRef.current) setApiError(err);
    } finally {
      if (aliveRef.current) {
        setReadProgress(null);
        setPhase('idle');
      }
    }
  };

  // ---- ① create -------------------------------------------------------------
  // `manifestStep`: a PUT …/manifest went first — it counts as one step of the
  // same progress bar.
  const sendRows = async (rep, index, rows, { manifestStep = false } = {}) => {
    const extra = manifestStep ? 1 : 0;
    if (!rows.length) {
      setPhase((p) => (p === 'replacing' ? 'idle' : p));
      setSendProgress(null);
      return;
    }
    const lim = limitsOf(rep);
    const opts = newReadOpts();
    const { signal } = opts;
    setProblems([]);
    setApiError(null);
    setPhase('sending');
    setSendProgress(manifestStep ? { done: 1, total: rows.length + 1, manifest: true } : null);
    let done = 0;
    try {
      const pre = await precheckFiles(index, rows, lim, opts);
      if (pre.length) {
        if (aliveRef.current) setProblems(pre);
        return;
      }
      const jsonSizes = new Map();
      for (const i of rows) {
        // eslint-disable-next-line no-await-in-loop
        jsonSizes.set(i.row, await designJsonSize(index, i, opts));
      }
      const chunks = chunkRows(rows, Math.min(lim.files_chunk || 25, 25), 8 * 1024 * 1024, (i) =>
        jsonSizes.get(i.row),
      );
      if (aliveRef.current) {
        setReadProgress(null);
        setSendProgress({ done: extra, total: rows.length + extra, manifest: manifestStep });
      }
      for (const chunk of chunks) {
        const payload = [];
        for (const i of chunk) {
          // One ZIP open at a time.
          // eslint-disable-next-line no-await-in-loop
          payload.push(await buildFilesRow(index, i, { signal }));
        }
        // eslint-disable-next-line no-await-in-loop
        await withRetry(() => sendFiles({ uid: rep.uid, items: payload }).unwrap(), { signal });
        done += chunk.length;
        if (aliveRef.current) {
          setSendProgress({ done: done + extra, total: rows.length + extra, manifest: manifestStep });
        }
      }
    } catch (err) {
      if (aliveRef.current && !isAbortError(err) && err?.status !== 401) setApiError(err);
    } finally {
      // Cancelling the import stops this run too, and owns the phase from there.
      if (aliveRef.current) {
        setPhase((p) => (p === 'sending' ? 'idle' : p));
        setReadProgress(null);
        setSendProgress(null);
      }
    }
  };

  // After a new manifest: keep per-row state only for folders still in it.
  // Everything is keyed by folder, so it follows rows that were renumbered.
  const remapRowState = (newItems) => {
    runRef.current = pruneByRows(runRef.current, newItems);
    flush();
    sessionsRef.current = pruneByRows(sessionsRef.current, newItems, (k) => k.slice(0, k.lastIndexOf('/')));
    setMismatch([]);
  };

  /**
   * "Check again". mode 'awaiting' (draft: rows not yet checked) or 'all'
   * (every row a re-check may fix). manifest.csv unchanged → /files only, as
   * before. Changed (or unknown) → PUT …/manifest, then /files for every row
   * now awaiting_files, under one progress bar. Unreadable → ask for the
   * folder again; pickFolder continues from here.
   */
  const recheck = async (mode) => {
    const index = folderRef.current;
    if (!index || !report) return;
    setApiError(null);
    setConflict(null);
    setProblems([]);
    const res = await checkManifest(index, recallManifest(uid, report));
    if (!aliveRef.current) return;
    setManifestCheck(res);
    if (res.state === 'unreadable') {
      pendingRecheckRef.current = mode;
      return;
    }
    pendingRecheckRef.current = null;

    if (res.state === 'unchanged') {
      await sendRows(report, index, items.filter(mode === 'awaiting' ? needsFiles : canRecheck));
      return;
    }

    setPhase('replacing');
    setSendProgress({ done: 0, total: manifestRowCount(res.text) + 1, manifest: true });
    let rep;
    try {
      rep = await replaceManifest({ uid, manifest: res.text }).unwrap();
    } catch (err) {
      if (!aliveRef.current) return;
      setPhase('idle');
      setSendProgress(null);
      if (err?.status === 409) {
        // Started / finished / cancelled elsewhere: show where it is now.
        setConflict(err);
        refetch();
      } else if (err?.status !== 401) {
        // 400: the import is untouched — the old report stays on screen.
        setApiError(err);
      }
      return;
    }
    rememberManifest(uid, res.text);
    if (!aliveRef.current) return;
    remapRowState(rep.items || []);
    setManifestCheck({ state: 'unchanged', text: res.text });
    await sendRows(rep, index, (rep.items || []).filter(needsFiles), { manifestStep: true });
  };

  const onCreate = async () => {
    if (!folder) return;
    setApiError(null);
    let text;
    try {
      text = await folder.manifest.text();
    } catch {
      setProblems(['manifest.csv changed on disk since the folder was picked — pick the folder again.']);
      return;
    }
    const pre = precheckManifest(text);
    if (pre.problems.length) {
      setProblems(pre.problems);
      return;
    }
    setProblems([]);
    setPhase('creating');
    let rep;
    try {
      rep = await createImport({ label: label.trim() || undefined, manifest: text }).unwrap();
    } catch (err) {
      setPhase('idle');
      if (err?.status !== 401) setApiError(err);
      return;
    }
    rememberFolder(rep.uid, folder);
    rememberManifest(rep.uid, text);
    saveFolderName(rep.uid, folder.rootName);
    navigate(`/template-imports/${rep.uid}`, { replace: true });
    setPhase('idle');
    await sendRows(rep, folder, (rep.items || []).filter(needsFiles));
  };

  // ---- ④ + ⑤ uploads ------------------------------------------------------------
  const beginUploads = useCallback(
    async (rep, onlyRows) => {
      const index = folderRef.current;
      if (!index || !rep) return;
      const candidates = (onlyRows || rep.items || []).filter(isUploadable);
      setPhase('reading');
      let bad;
      try {
        const found = await mismatchedRows(index, candidates, newReadOpts());
        bad = new Map(found.map((m) => [m.key, m.problem]));
      } catch (err) {
        if (aliveRef.current) {
          if (!isAbortError(err)) setApiError(err);
          setReadProgress(null);
          setPhase((p) => (p === 'reading' ? 'idle' : p));
        }
        return;
      }
      if (!aliveRef.current) return;
      setReadProgress(null);
      // Per-row state is keyed by folder (rowKey), never by row number.
      bad.forEach((problem, key) => {
        runRef.current.set(key, { state: 'error', message: `${problem} — pick the same folder again.` });
      });
      const todo = candidates.filter((i) => !bad.has(rowKey(i)));
      todo.forEach((i) => {
        runRef.current.set(rowKey(i), { state: 'queued', sent: 0, total: 0 });
      });
      flush();
      if (!todo.length) {
        setPhase('idle');
        return;
      }

      setPhase('uploading');
      const runner = createUploadRunner({
        index,
        items: todo,
        sessions: sessionsRef.current,
        calls: {
          presign: (row) => presign({ uid: rep.uid, row }).unwrap(),
          complete: (row) => completeRow({ uid: rep.uid, row }).unwrap(),
          initiate,
          presignParts,
          multipartComplete,
        },
        on: {
          rowState: (key, state, msg) => {
            const prev = runRef.current.get(key) || {};
            runRef.current.set(key, { ...prev, state, message: msg ?? null });
            flush();
          },
          rowProgress: (key, p) => {
            const prev = runRef.current.get(key) || {};
            runRef.current.set(key, { ...prev, ...p });
            dirtyRef.current = true;
          },
          authEnded: () => message.error('Your session ended — sign in again and resume the import.'),
        },
      });
      runnerRef.current = runner;
      await runner.done;
      // A restart (wake-up / back online) replaced this runner — it owns the phase now.
      if (runnerRef.current !== runner || !aliveRef.current) return;
      runnerRef.current = null;
      flush();
      setPhase('idle');
      refetch();
    },
    [flush, newReadOpts, presign, completeRow, initiate, presignParts, multipartComplete, message, refetch],
  );

  const pauseUploads = () => {
    runnerRef.current?.stop();
  };

  // Laptop woke up / network came back: abort in-flight PUTs, re-read the
  // server's stages, and continue each row from there.
  const restartRef = useRef(null);
  restartRef.current = async () => {
    const r = runnerRef.current;
    if (!r) return;
    runnerRef.current = null;
    r.stop();
    await r.done;
    if (!aliveRef.current) return;
    const res = await refetch();
    if (!aliveRef.current) return;
    if (res?.data) await beginUploads(res.data);
    else setPhase('idle');
    if (!runnerRef.current && aliveRef.current) setPhase('idle');
  };

  useEffect(() => {
    if (phase !== 'uploading') return undefined;
    let hiddenAt = null;
    const onOnline = () => restartRef.current?.();
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = null;
      if (away > 30 * 1000) restartRef.current?.();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [phase]);

  // ---- ③ start, ⑥ finalize, cancel ------------------------------------------------
  const doStart = async () => {
    setApiError(null);
    setPhase('starting');
    let rep;
    try {
      rep = await startImport(uid).unwrap();
    } catch (err) {
      setPhase('idle');
      if (err?.status !== 401) setApiError(err);
      return;
    }
    setPhase('idle');
    if (folderRef.current) await beginUploads(rep);
  };

  // An edited manifest.csv that was never sent would be lost by starting now.
  const onStart = () => {
    if (manifestCheck?.state !== 'changed') {
      doStart();
      return;
    }
    modal.confirm({
      title: 'manifest.csv has changed since it was checked',
      content:
        'Starting imports the rows as last checked; the edits never reach the server and manifest.csv cannot be replaced after Start. Check again first to use the edited file.',
      okText: 'Start with the checked rows',
      cancelText: 'Go back',
      onOk: doStart,
    });
  };

  const onFinalize = async () => {
    setApiError(null);
    setPhase('finalizing');
    try {
      const rep = await finalizeImport(uid).unwrap();
      message.success(
        rep?.status === 'completed' ? 'Import finished — everything is live.' : 'Import finished with issues — see the report.',
      );
    } catch (err) {
      if (err?.status !== 401) setApiError(err);
    } finally {
      setPhase('idle');
    }
  };

  const createdDrafts = items.filter(
    (i) => i.template_uid && i.result !== 'published' && i.template_status !== 'active',
  ).length;

  const onCancel = () => {
    modal.confirm({
      title: 'Cancel this import?',
      content:
        createdDrafts > 0
          ? `Remove the ${createdDrafts} draft version(s) this import created? Designs it created that are left with no versions are removed too. Published rows, versions that existed before, and created tags are kept.`
          : 'Nothing has been added to the catalog yet. The import is closed and cannot be resumed.',
      okText: createdDrafts > 0 ? `Remove ${createdDrafts} draft version(s)` : 'Cancel import',
      okButtonProps: { danger: true },
      cancelText: 'Keep it',
      onOk: async () => {
        runnerRef.current?.stop();
        runnerRef.current = null;
        setPhase('cancelling');
        stopReading();
        try {
          await cancelImport(uid).unwrap();
          forgetManifest(uid);
          message.success('Import cancelled.');
          refetch();
        } catch (err) {
          if (err?.status !== 401) setApiError(err);
        } finally {
          setPhase('idle');
        }
      },
    });
  };

  // ---- derived ----------------------------------------------------------------------
  const busy = phase !== 'idle';
  // `phase`: bundles are read into a cache on the index, which is not state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const notes = useMemo(() => bundleNotes(folder, items), [folder, items, phase]);
  const fileWarningRows = items.filter((i) => (i.warnings || []).some(isFileWarning)).length;
  const uploadable = items.filter(isUploadable);
  const localErrors = items.filter((i) => run.get(rowKey(i))?.state === 'error').length;
  const stillPending = items.filter(
    (i) => (i.stage === 'created' || i.stage === 'uploading') && run.get(rowKey(i))?.state !== 'error',
  ).length;
  const failedRows = items.filter((i) => i.stage === 'failed' || run.get(rowKey(i))?.state === 'error');
  const createdTotal = items.filter((i) =>
    ['created', 'uploading', 'completed', 'failed'].includes(i.stage),
  ).length;
  const runBytes = useMemo(() => {
    let sent = 0;
    let total = 0;
    run.forEach((r) => {
      sent += r.sent || 0;
      total += r.total || 0;
    });
    return { sent, total };
  }, [run]);

  // ---- render ----------------------------------------------------------------------
  if (!isNew && isLoading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }
  if (!isNew && loadError) {
    return (
      <Result
        status={loadError.status === 404 ? '404' : 'error'}
        title={loadError.status === 404 ? 'Import not found' : 'Could not load the import'}
        subTitle={errorText(loadError)}
        extra={
          <Space>
            <Button onClick={() => navigate('/template-imports')}>All imports</Button>
            <Button type="primary" onClick={refetch}>
              Try again
            </Button>
          </Space>
        }
      />
    );
  }

  const stepCurrent = isNew ? 0 : STEP_OF[status] ?? 0;

  const header = (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 16,
      }}
    >
      <Space direction="vertical" size={2}>
        <Link to="/template-imports">
          <ArrowLeftOutlined /> All imports
        </Link>
        <Space wrap align="center">
          <Title level={4} style={{ margin: 0 }}>
            {isNew ? 'New template import' : report?.label || 'Untitled import'}
          </Title>
          {status && <Tag color={IMPORT_STATUS[status]?.color}>{IMPORT_STATUS[status]?.label || status}</Tag>}
          {report?.is_paused && phase !== 'uploading' && (
            <Tag icon={<PauseCircleOutlined />} color="warning">
              Paused
            </Tag>
          )}
        </Space>
        {!isNew && report && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {report.total_items ?? items.length} row(s)
            {report.files ? ` · ${report.files.count} file(s), ${fmtBytes(report.files.bytes)}` : ''} · created{' '}
            {fmt(report.created_at)}
            {report.started_at ? ` · started ${fmt(report.started_at)}` : ''}
            {report.finished_at ? ` · finished ${fmt(report.finished_at)}` : ''}
            {report.last_activity_at ? ` · last activity ${fmt(report.last_activity_at)}` : ''}
          </Text>
        )}
      </Space>
      {!isNew && (
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={refetch} loading={isFetching} disabled={busy}>
            Reload
          </Button>
          {canWrite && status && status !== 'cancelled' && (
            <Button danger icon={<StopOutlined />} onClick={onCancel} disabled={phase === 'cancelling'}>
              Cancel import
            </Button>
          )}
        </Space>
      )}
    </div>
  );

  const steps = (
    <Steps
      size="small"
      current={stepCurrent}
      status={status === 'cancelled' ? 'error' : undefined}
      style={{ marginBottom: 20 }}
      items={[
        { title: 'Pick folder' },
        { title: 'Check files' },
        { title: 'Review' },
        { title: 'Upload' },
        { title: 'Finalize' },
      ]}
    />
  );

  const stageTags = (
    <Space size={[4, 4]} wrap>
      {STAGE_ORDER.filter((s) => counts[s]).map((s) => (
        <Tag key={s} color={STAGE[s].color} style={{ marginInlineEnd: 0 }}>
          {counts[s]} {STAGE[s].label.toLowerCase()}
        </Tag>
      ))}
    </Space>
  );

  const readingBar = readProgress && (
    <div>
      <Space>
        <Text>
          Reading {readProgress.done} / {readProgress.total} ZIPs
        </Text>
        <Button size="small" onClick={stopReading}>
          Stop
        </Button>
      </Space>
      <Progress percent={Math.floor((readProgress.done / readProgress.total) * 100)} status="active" />
    </div>
  );

  const fileWarningAlert = fileWarningRows > 0 && (
    <Alert
      type="warning"
      showIcon
      message={`${fileWarningRows} row(s) have a warning about their files`}
      description="They are still imported. A file the design uses that is not in the bundle keeps that version and its design as drafts until the file is added; a file loaded from a URL outside the bundle keeps loading from there. The details are on each row below."
    />
  );

  // A 409 from PUT …/manifest: the import moved on (started, finished, cancelled).
  const conflictAlert = conflict && (
    <Alert
      type="warning"
      showIcon
      closable
      onClose={() => setConflict(null)}
      message={errorText(conflict)}
      description={
        <>
          manifest.csv can only be replaced before the import starts. To use the edited file, cancel this import
          (<Text strong>Cancel import</Text>, top right) and <Link to="/template-imports/new">start a new import</Link>.
        </>
      }
    />
  );

  const mismatchAlert = mismatch.length > 0 && (
    <Alert
      type="warning"
      showIcon
      message={`${mismatch.length} row(s) do not match the files the server was told about — they will be skipped.`}
      description={
        <ul style={{ margin: 0, paddingInlineStart: 18 }}>
          {mismatch.slice(0, 10).map((m) => (
            <li key={m.key}>
              Line {m.line ?? m.row}: {m.problem}
            </li>
          ))}
          {mismatch.length > 10 && <li>…and {mismatch.length - 10} more</li>}
        </ul>
      }
    />
  );

  const picker = (hint) => (
    <Space direction="vertical" style={{ width: '100%' }}>
      {hint && <Text>{hint}</Text>}
      <TemplateImportFolderPicker
        onPicked={pickFolder}
        picked={folder}
        expectName={expectName}
        disabled={busy}
      />
    </Space>
  );

  // ---- step panels ------------------------------------------------------------------
  let panel = null;

  if (isNew) {
    panel = (
      <Card size="small">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Paragraph style={{ margin: 0 }}>
            Pick the batch folder: <Text code>manifest.csv</Text> at the top (one row per version) and one ZIP per
            version holding the design <Text code>.json</Text>, its thumbnail and every file it uses. Unzipped folders
            also work. Nothing in the catalog changes until you review the check and start the import.
          </Paragraph>
          <FolderStructure />
          <ManifestTemplateLinks size="small" />
          <Input
            placeholder="Label (optional), e.g. Diwali batch 2"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={120}
            style={{ maxWidth: 420 }}
          />
          {picker()}
          <Problems problems={problems} />
          <ApiError error={apiError} onClose={() => setApiError(null)} />
          <Button
            type="primary"
            icon={<FileSearchOutlined />}
            disabled={!folder || !canWrite}
            loading={phase === 'creating'}
            onClick={onCreate}
          >
            Check manifest
          </Button>
        </Space>
      </Card>
    );
  } else if (editable) {
    const awaiting = items.filter(needsFiles);
    const recheckable = items.filter(canRecheck);
    const manifestRejected = items.filter(isManifestRejected);
    const validCount = counts.valid || 0;
    const mState = folder ? manifestCheck?.state : null;
    const manifestNew = mState === 'changed' || mState === 'unknown';
    const unreadable = mState === 'unreadable';
    const checking = phase === 'sending' || phase === 'replacing';
    const manifestLabel =
      mState === 'changed' ? 'Manifest changed — check all rows again' : 'Check all rows again, manifest.csv included';
    const showAwaitingFlow = status === 'draft' && awaiting.length > 0;
    const canOpenRecheck = canWrite && (recheckable.length > 0 || manifestRejected.length > 0);

    const manifestNotice = unreadable ? (
      <Alert
        type="warning"
        showIcon
        message="manifest.csv changed on disk since the folder was picked"
        description="The browser can no longer read the copy it was given. Pick the folder again — the check carries on as soon as you do."
      />
    ) : mState === 'changed' ? (
      <Alert
        type="info"
        showIcon
        message="manifest.csv has changed since it was checked"
        description="Checking again sends the new manifest first: every row is rebuilt from it (rows after an added or removed line are renumbered) and the files of every accepted row are checked again."
      />
    ) : null;

    const staleHint = folder && !unreadable && (
      <Text type="secondary" style={{ fontSize: 12 }}>
        Edited manifest.csv and this page does not say so? Some browsers keep the copy read when the folder was
        picked — pick the folder again.
      </Text>
    );

    const checkProgress = checking && sendProgress && (
      <div>
        <Space>
          <Text>
            {!sendProgress.manifest
              ? `Checking ${sendProgress.done} / ${sendProgress.total} rows`
              : phase === 'replacing'
              ? 'Sending manifest.csv…'
              : `manifest.csv accepted · checking ${Math.max(0, sendProgress.done - 1)} / ${sendProgress.total - 1} rows`}
          </Text>
          {phase === 'sending' && (
            <Button size="small" onClick={stopReading}>
              Stop
            </Button>
          )}
        </Space>
        <Progress
          percent={Math.floor((sendProgress.done / Math.max(1, sendProgress.total)) * 100)}
          status="active"
        />
      </div>
    );

    // Unchanged manifest and nothing a re-check of the files can fix: only the
    // manifest can fix the rejected rows.
    const recheckButton = (
      <Button
        style={{ marginTop: 12 }}
        icon={<FileSearchOutlined />}
        disabled={!folder || busy || unreadable || (!manifestNew && recheckable.length === 0)}
        onClick={async () => {
          await recheck('all');
          if (aliveRef.current && !pendingRecheckRef.current) setShowRepick(false);
        }}
      >
        {manifestNew
          ? manifestLabel
          : recheckable.length
          ? `Check ${recheckable.length} row(s) again`
          : 'Fix manifest.csv first, then check again'}
      </Button>
    );

    panel = (
      <Card size="small">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {readingBar}
          {checkProgress}

          {showAwaitingFlow && !checking && (
            <>
              {!folder
                ? picker(
                    `${awaiting.length} row(s) still need their files checked. Pick the same folder again to continue.`,
                  )
                : picker()}
              {manifestNotice}
              <Button
                type="primary"
                icon={<FileSearchOutlined />}
                disabled={!folder || !canWrite || busy || unreadable}
                onClick={() => recheck('awaiting')}
              >
                {manifestNew
                  ? manifestLabel
                  : `Check files (${awaiting.length} row${awaiting.length === 1 ? '' : 's'})`}
              </Button>
              {staleHint}
            </>
          )}

          {!showAwaitingFlow && (
            <>
              <Space wrap align="center">
                <Text strong>Dry run:</Text>
                {stageTags}
              </Space>
              <Text type="secondary">
                Red rows will not be imported. Rows with amber warnings are imported; grey notes say what will happen
                (new tags, versions added to existing designs, files loaded by URL). “Publish check” predicts which
                designs will stay drafts.
              </Text>
              {fileWarningAlert}
              {manifestRejected.length > 0 && (
                <Alert
                  type="error"
                  showIcon
                  message={`${manifestRejected.length} row(s) were rejected by manifest.csv`}
                  description="Fix them in manifest.csv, then check again: the edited manifest is sent first and every row is checked again."
                />
              )}
              <Space wrap>
                <Button
                  type="primary"
                  icon={<RocketOutlined />}
                  disabled={status !== 'validated' || !validCount || !canWrite || busy}
                  loading={phase === 'starting'}
                  onClick={onStart}
                >
                  Import {validCount} valid row{validCount === 1 ? '' : 's'}
                </Button>
                {canOpenRecheck && (
                  <Button onClick={() => setShowRepick((v) => !v)} disabled={busy}>
                    {manifestNew && !showRepick ? manifestLabel : 'Fixed files or manifest.csv? Check again'}
                  </Button>
                )}
              </Space>
              {!folder && validCount > 0 && !showRepick && status === 'validated' && (
                <Alert
                  type="info"
                  showIcon
                  message="The files are not loaded in this tab"
                  description="You can start the import now; the uploads will then ask you to pick the same folder."
                />
              )}
              {(showRepick || unreadable) && canOpenRecheck && (
                <Card size="small" type="inner" title="Check again">
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {picker(
                      'Pick the folder again. An edited manifest.csv is sent first; otherwise every row that its files can fix is checked again.',
                    )}
                    {manifestNotice}
                    {staleHint}
                  </Space>
                  {recheckButton}
                </Card>
              )}
            </>
          )}

          <Problems problems={problems} />
          <ApiError error={apiError} onClose={() => setApiError(null)} />
        </Space>
      </Card>
    );
  } else if (status === 'running' || status === 'completed' || status === 'completed_with_issues') {
    const finished = status !== 'running';
    const completedCount = counts.completed || 0;
    const ready = phase === 'idle' && stillPending === 0;
    const designs = report?.designs || [];
    const outcomeCount = (o) => designs.filter((d) => d.outcome === o).length;
    panel = (
      <Card size="small">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Space wrap align="center" style={{ marginBottom: 4 }}>
              <Text strong>
                {completedCount} / {createdTotal} row(s) uploaded
              </Text>
              {stageTags}
            </Space>
            <Progress
              percent={createdTotal ? Math.floor((completedCount / createdTotal) * 100) : 0}
              status={phase === 'uploading' ? 'active' : failedRows.length ? 'exception' : undefined}
            />
            {phase === 'uploading' && runBytes.total > 0 && (
              <Text type="secondary">
                This run: {fmtBytes(runBytes.sent)} of {fmtBytes(runBytes.total)} · keep this tab open
              </Text>
            )}
          </div>

          {finished && (
            <Alert
              type={status === 'completed' ? 'success' : 'warning'}
              showIcon
              message={
                status === 'completed'
                  ? 'Every design went live.'
                  : 'Some rows or designs did not go live — the reasons are in the report below.'
              }
              description={
                <Space wrap size={4}>
                  {['published', 'already_live', 'draft', 'deleted'].map((o) =>
                    outcomeCount(o) ? (
                      <Tag key={o}>
                        {outcomeCount(o)} {o.replace('_', ' ')}
                      </Tag>
                    ) : null,
                  )}
                </Space>
              }
            />
          )}

          {readingBar}
          {fileWarningAlert}

          {!folder && uploadable.length > 0 && canWrite &&
            picker(
              `${uploadable.length} row(s) still need uploading. Browsers do not keep access to files after a reload — pick the same folder again${
                expectName ? ` (“${expectName}”)` : ''
              }. Rows already uploaded are skipped.`,
            )}
          {folder && showRepick && picker()}
          {uploadable.length > 0 && mismatchAlert}

          <Space wrap>
            {phase === 'uploading' ? (
              <Button icon={<PauseOutlined />} onClick={pauseUploads}>
                Pause
              </Button>
            ) : (
              canWrite &&
              uploadable.length > 0 && (
                <Button
                  type={stillPending > 0 ? 'primary' : 'default'}
                  icon={<CloudUploadOutlined />}
                  disabled={!folder || busy}
                  onClick={() => {
                    runRef.current = new Map();
                    flush();
                    beginUploads(report);
                  }}
                >
                  {failedRows.length && !stillPending
                    ? `Retry ${uploadable.length} failed row(s)`
                    : `Upload ${uploadable.length} row(s)`}
                </Button>
              )
            )}
            {canWrite && folder && phase !== 'uploading' && uploadable.length > 0 && (
              <Button type="link" onClick={() => setShowRepick((v) => !v)}>
                Pick the folder again
              </Button>
            )}
            {canWrite && (
              <Tooltip
                title={
                  !ready && phase === 'uploading'
                    ? 'Wait for the uploads to finish, or pause them first.'
                    : 'Publishes each design that passes the checks; the rest stay drafts with reasons.'
                }
              >
                <Button
                  type={ready && phase !== 'uploading' && (!finished || failedRows.length === 0) ? 'primary' : 'default'}
                  icon={<RocketOutlined />}
                  disabled={phase === 'uploading' || (busy && phase !== 'finalizing')}
                  loading={phase === 'finalizing'}
                  onClick={() => {
                    if (stillPending > 0) {
                      modal.confirm({
                        title: 'Finalize with rows not uploaded?',
                        content: `${stillPending} row(s) have not finished uploading. They will stay drafts; you can upload them later and finalize again.`,
                        okText: 'Finalize anyway',
                        onOk: onFinalize,
                      });
                    } else onFinalize();
                  }}
                >
                  {finished ? 'Finalize again' : 'Finalize'}
                </Button>
              </Tooltip>
            )}
          </Space>

          {ready && !finished && createdTotal > 0 && (
            <Alert
              type={failedRows.length ? 'warning' : 'success'}
              showIcon
              message={
                failedRows.length
                  ? `${failedRows.length} row(s) failed${localErrors ? ' or stopped' : ''}. Retry them, or finalize now and they stay drafts.`
                  : 'Every row is uploaded. Finalize to publish the designs that pass the checks.'
              }
            />
          )}

          <ApiError error={apiError} onClose={() => setApiError(null)} />
        </Space>
      </Card>
    );
  } else if (status === 'cancelled') {
    panel = (
      <Alert
        type="info"
        showIcon
        message="This import was cancelled"
        description="Draft versions it created were removed. Published rows, pre-existing versions and created tags were kept."
      />
    );
  }

  return (
    <>
      {header}
      {steps}
      {conflictAlert && <div style={{ marginBottom: 12 }}>{conflictAlert}</div>}
      {panel}
      {!isNew && report && (
        <div style={{ marginTop: 16 }}>
          <TemplateImportReport report={report} run={run} notes={notes} />
        </div>
      )}
      {!isNew && limits && (
        <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
          Limits per import: {limits.max_rows} rows, {limits.max_families} designs, {limits.max_files} files,{' '}
          {fmtBytes(limits.max_total_bytes)} (unzipped); design JSON up to {fmtBytes(limits.max_content_bytes)}; files over{' '}
          {fmtBytes(limits.multipart_over)} upload in parts.
        </Text>
      )}
    </>
  );
}
