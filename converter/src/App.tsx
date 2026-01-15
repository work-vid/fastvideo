import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Command, Child } from "@tauri-apps/plugin-shell";
import { join, basename, extname } from "@tauri-apps/api/path";
import "./App.css";

// --- Icons ---
const CogIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
);
const FolderIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
);
const BackIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
);
const PlayIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
);
const StopIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="12" height="12"/></svg>
);
const CheckIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
);

// Helper to parse HH:MM:SS.ms to seconds
const parseDuration = (timeStr: string) => {
    const parts = timeStr.split(':');
    if (parts.length < 3) return 0;
    const h = parseFloat(parts[0]);
    const m = parseFloat(parts[1]);
    const s = parseFloat(parts[2]);
    return (h * 3600) + (m * 60) + s;
};

interface LogEntry {
    file: string;
    status: 'pending' | 'processing' | 'done' | 'error' | 'skipped' | 'cancelled';
    msg: string;
    duration?: number;
    progress?: number;
}

function App() {
    const [view, setView] = useState<'HOME' | 'SETTINGS'>('HOME');
    const [inputDir, setInputDir] = useState<string | null>(null);
    const [files, setFiles] = useState<string[]>([]);
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    
    // Process State
    const [processing, setProcessing] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    
    // Refs for cancellation
    const currentChildRef = useRef<Child | null>(null);
    const abortRef = useRef(false);
    const currentOutputRef = useRef<string | null>(null);
    const autoConflictResolution = useRef<'overwrite' | 'skip' | null>(null);
    
    // Overwrite Dialog State
    type OverwriteChoice = 'overwrite' | 'skip' | 'cancel';
    const [overwriteDialog, setOverwriteDialog] = useState<{
        file: string;
        resolve: (result: { choice: OverwriteChoice, remember: boolean }) => void;
    } | null>(null);
    const [remember, setRemember] = useState(false);

    // Settings
    const [outputDir, setOutputDir] = useState("");
    const [suffix, setSuffix] = useState("");
    const [prefix, setPrefix] = useState("");
    const [cmdOverride, setCmdOverride] = useState("");

    useEffect(() => {
        const stored = localStorage.getItem('fv_settings');
        if (stored) {
            const p = JSON.parse(stored);
            setOutputDir(p.outputDir || "");
            setSuffix(p.suffix || "");
            setPrefix(p.prefix || "");
            setCmdOverride(p.cmdOverride || "");
        }
    }, []);

    const saveSettings = () => {
        localStorage.setItem('fv_settings', JSON.stringify({ outputDir, suffix, prefix, cmdOverride }));
        setView('HOME');
    };

    const handleSelectFolder = async () => {
        const selected = await open({ directory: true, multiple: false });
        if (selected && typeof selected === 'string') {
            setInputDir(selected);
            const videoFiles = await invoke<string[]>("list_video_files", { path: selected });
            setFiles(videoFiles);
            // Auto-select all
            setSelectedFiles(new Set(videoFiles));
            setLogs(videoFiles.map(f => ({ file: f, status: 'pending', msg: 'Ready', progress: 0 })));
        }
    };

    const handleSelectOutputFolder = async () => {
        const selected = await open({ directory: true, multiple: false });
        if (selected && typeof selected === 'string') {
            setOutputDir(selected);
        }
    };

    const toggleSelection = (file: string) => {
        if (processing) return;
        const next = new Set(selectedFiles);
        if (next.has(file)) next.delete(file);
        else next.add(file);
        setSelectedFiles(next);
    };

    const toggleAll = () => {
        if (processing) return;
        if (selectedFiles.size === files.length) {
            setSelectedFiles(new Set());
        } else {
            setSelectedFiles(new Set(files));
        }
    };

    const parseCommand = (inputPath: string, outputPath: string) => {
        let cmdStr = cmdOverride;
        if (!cmdStr || cmdStr.trim() === "") {
            cmdStr = `-i "{input}" -c:v libx265 -crf 23 -preset medium -c:a aac -b:a 192k -tag:v hvc1 "{output}"`;
        }
        const filled = cmdStr.replace(/{input}/g, inputPath).replace(/{output}/g, outputPath);
        const args: string[] = [];
        const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
        let match;
        while ((match = regex.exec(filled)) !== null) {
            if (match[1]) args.push(match[1]);
            else if (match[2]) args.push(match[2]);
            else args.push(match[0]);
        }
        return args;
    };

    const cancelConversion = async () => {
        if (!processing) return;
        abortRef.current = true;
        
        // Kill current process if exists
        if (currentChildRef.current) {
            try {
                await currentChildRef.current.kill(); 
                // Wait small bit for release
                await new Promise(r => setTimeout(r, 200));
                
                // Cleanup partial file
                if (currentOutputRef.current) {
                    await invoke("delete_file", { path: currentOutputRef.current });
                }
            } catch (_e) {
                console.error("Failed to kill/cleanup", _e);
            }
        }
        
        // Also close dialog if open
        if (overwriteDialog) {
             overwriteDialog.resolve({ choice: 'cancel', remember: false });
             setOverwriteDialog(null);
        }
    };

    const runConversion = async () => {
        if (!inputDir || selectedFiles.size === 0) return;
        
        setProcessing(true);
        abortRef.current = false;
        currentOutputRef.current = null;
        autoConflictResolution.current = null;

        // Reset logs for selected files
        setLogs(prev => prev.map(l => selectedFiles.has(l.file) ? { ...l, status: 'pending', msg: 'Queued', progress: 0 } : l));

        for (const file of files) {
            if (abortRef.current) break;
            if (!selectedFiles.has(file)) continue;

            setLogs(prev => prev.map(l => l.file === file ? { ...l, status: 'processing', msg: 'Initializing...', progress: 0 } : l));

            try {
                const inputPath = await join(inputDir, file);
                
                let outDir = outputDir;
                if (!outDir) outDir = await join(inputDir, "output");
                await invoke("ensure_dir", { path: outDir });
                
                const ext = await extname(file);
                const name = await basename(file, "." + ext);
                const newName = `${prefix}${name}${suffix}.${ext}`;
                const outputPath = await join(outDir, newName);
                
                currentOutputRef.current = outputPath;

                // Check Overwrite
                const exists = await invoke<boolean>("file_exists", { path: outputPath });
                if (exists) {
                    let resolution = autoConflictResolution.current;

                    if (!resolution) {
                        setLogs(prev => prev.map(l => l.file === file ? { ...l, msg: 'File exists...' } : l));
                        setRemember(false); // Reset checkbox
                        
                        // Ask user
                        const result = await new Promise<{ choice: OverwriteChoice, remember: boolean }>(resolve => {
                            setOverwriteDialog({ file: newName, resolve });
                        });
                        setOverwriteDialog(null);

                        if (result.choice === 'cancel') {
                            abortRef.current = true;
                            setLogs(prev => prev.map(l => l.file === file ? { ...l, status: 'cancelled', msg: 'Cancelled by user' } : l));
                            break;
                        }

                        if (result.remember) {
                            autoConflictResolution.current = result.choice as 'overwrite' | 'skip';
                        }
                        resolution = result.choice as 'overwrite' | 'skip';
                    }

                    if (resolution === 'skip') {
                        setLogs(prev => prev.map(l => l.file === file ? { ...l, status: 'skipped', msg: 'Skipped' } : l));
                        continue;
                    }
                    // proceed to overwrite
                }

                const args = parseCommand(inputPath, outputPath);
                if (!args.includes("-y")) {
                     args.unshift("-y");
                }
                
                // Spawn FFmpeg
                const command = Command.sidecar("binaries/ffmpeg", args);
                
                let stderrBuffer = "";
                let totalDuration = 0;

                command.stderr.on("data", (line) => {
                   stderrBuffer += line + "\n";
                   
                   const durMatch = line.match(/Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/);
                   if (durMatch && durMatch[1]) {
                       totalDuration = parseDuration(durMatch[1]);
                   }

                   const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
                   if (timeMatch && timeMatch[1] && totalDuration > 0) {
                       const current = parseDuration(timeMatch[1]);
                       const percent = Math.min(100, (current / totalDuration) * 100);
                       setLogs(prev => prev.map(l => l.file === file ? { ...l, progress: percent, msg: `Encoding ${percent.toFixed(0)}%` } : l));
                   } else if (!totalDuration) {
                       setLogs(prev => prev.map(l => l.file === file ? { ...l, msg: "Starting..." } : l));
                   }
                });

                const child = await command.spawn();
                currentChildRef.current = child;

                await new Promise<void>((resolve) => {
                    command.on("close", (data) => {
                        if (abortRef.current) {
                             setLogs(prev => prev.map(l => l.file === file ? { ...l, status: 'cancelled', msg: 'Cancelled' } : l));
                        } else if (data.code === 0) {
                             setLogs(prev => prev.map(l => l.file === file ? { ...l, status: 'done', msg: 'Completed', progress: 100 } : l));
                        } else {
                             const errorMsg = stderrBuffer.split('\n').filter(l => l.trim() !== "").slice(-1)[0] || `Error ${data.code}`;
                             setLogs(prev => prev.map(l => l.file === file ? { ...l, status: 'error', msg: errorMsg.substring(0, 40) } : l));
                        }
                        resolve();
                    });
                    command.on("error", (_error) => {
                        setLogs(prev => prev.map(l => l.file === file ? { ...l, status: 'error', msg: "Failed to spawn" } : l));
                        resolve();
                    });
                });
                
                currentChildRef.current = null;

            } catch (_e: any) {
                setLogs(prev => prev.map(l => l.file === file ? { ...l, status: 'error', msg: "Error" } : l));
            }
        }
        setProcessing(false);
    };

    if (view === 'SETTINGS') {
        return (
            <div className="container animate-fade-in" style={{ padding: '2rem' }}>
                <div className="header">
                    <button onClick={() => saveSettings()} className="btn-secondary flex-center"><BackIcon/></button>
                    <h2>Settings</h2>
                </div>
                
                <div className="glass-panel" style={{ padding: '1.5rem', marginTop: '1rem' }}>
                    <div className="form-group">
                        <label>Output Destination</label>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <input type="text" value={outputDir} readOnly placeholder="Default: source/output" />
                          <button className="btn-secondary flex-center" onClick={handleSelectOutputFolder}><FolderIcon/></button>
                        </div>
                        <small>Defaults to 'output' folder in source directory</small>
                    </div>

                    <div className="form-group" style={{ marginTop: '1rem' }}>
                        <label>Filename Prefix</label>
                        <input type="text" value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="e.g. converted_" />
                    </div>

                    <div className="form-group" style={{ marginTop: '1rem' }}>
                        <label>Filename Suffix</label>
                        <input type="text" value={suffix} onChange={e => setSuffix(e.target.value)} placeholder="e.g. _hevc" />
                    </div>

                    <div className="form-group" style={{ marginTop: '1rem' }}>
                        <label>Command Override</label>
                        <textarea 
                          rows={4} 
                          value={cmdOverride} 
                          onChange={e => setCmdOverride(e.target.value)}
                          placeholder={`ffmpeg -i {input} -c:v libx265 ... {output}`}
                        />
                        <small>Use <code>{`{input}`}</code> and <code>{`{output}`}</code> as placeholders.</small>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <main className="container animate-fade-in" style={{ padding: '2rem', height: '100vh', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>                    
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.02em' }}>FastVideo</h1>
                </div>
                <button className="btn-secondary flex-center" onClick={() => setView('SETTINGS')} disabled={processing}>
                    <CogIcon /> Settings
                </button>
            </div>

            {/* Main Action Area */}
            <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                {!inputDir ? (
                    <div style={{ padding: '3rem 0', textAlign: 'center' }}>
                        <div style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>Select a folder to scan for videos</div>
                        <button className="btn-primary flex-center" style={{ margin: '0 auto' }} onClick={handleSelectFolder}>
                            <FolderIcon /> Select Folder
                        </button>
                    </div>
                ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                         <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                             <label style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>Input Source</label>
                             <div style={{ fontFamily: 'monospace', background: 'rgba(0,0,0,0.2)', padding: '0.25rem 0.5rem', borderRadius: '4px' }}>
                                 {inputDir}
                             </div>
                         </div>
                         <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button className="btn-secondary flex-center" onClick={handleSelectFolder} disabled={processing}>
                                <FolderIcon /> Change
                            </button>
                            
                            {processing ? (
                                <button className="btn-danger flex-center" onClick={cancelConversion}>
                                    <StopIcon /> Stop
                                </button>
                            ) : (
                                <button className="btn-primary flex-center" onClick={runConversion} disabled={selectedFiles.size === 0}>
                                    <PlayIcon /> Start ({selectedFiles.size})
                                </button>
                            )}
                         </div>
                     </div>
                )}
            </div>

            {/* File List */}
            <div className="glass-panel" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                        Queue ({files.length})
                    </h3>
                    {files.length > 0 && (
                        <button 
                            onClick={toggleAll} 
                            disabled={processing}
                            style={{ fontSize: '0.8rem', color: 'var(--primary-color)', fontWeight: 500, opacity: processing ? 0.5 : 1 }}
                        >
                            {selectedFiles.size === files.length ? 'Deselect All' : 'Select All'}
                        </button>
                    )}
                </div>
                
                <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
                    {files.length === 0 ? (
                        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            No video files found.
                        </div>
                    ) : (
                        files.map((f, i) => {
                            const log = logs.find(l => l.file === f);
                            const isSelected = selectedFiles.has(f);
                            const isProcessing = log?.status === 'processing';
                            const isDone = log?.status === 'done';
                            const isError = log?.status === 'error';
                            const isSkipped = log?.status === 'skipped';

                            return (
                                <div key={i} className={`file-row ${isSelected ? 'selected' : ''}`} style={{ 
                                    padding: '0.75rem', 
                                    margin: '0.25rem 0', 
                                    borderRadius: '8px', 
                                    background: isProcessing ? 'rgba(241, 99, 213, 0.1)' : 'transparent',
                                    border: isProcessing ? '1px solid rgba(241, 99, 227, 0.3)' : '1px solid transparent',
                                    transition: 'all 0.2s',
                                    opacity: !isSelected && !processing ? 0.6 : 1
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                            <div 
                                                onClick={() => toggleSelection(f)}
                                                style={{ 
                                                    width: '18px', height: '18px', borderRadius: '4px', 
                                                    border: `2px solid ${isSelected ? 'var(--primary-color)' : 'var(--border-color)'}`,
                                                    background: isSelected ? 'var(--primary-color)' : 'transparent',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    cursor: processing ? 'default' : 'pointer',
                                                    color: 'white', flexShrink: 0
                                                }}
                                            >
                                                {isSelected && <CheckIcon />}
                                            </div>
                                            
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span style={{ fontSize: '0.9rem', fontWeight: isProcessing ? 600 : 400 }}>{f}</span>
                                            </div>
                                        </div>
                                        
                                        <span style={{ 
                                            fontSize: '0.75rem', fontFamily: 'monospace',
                                            color: isDone ? '#10b981' : isError ? '#ef4444' : isSkipped ? 'var(--text-secondary)' : 'var(--text-secondary)',
                                            background: isDone ? 'rgba(16, 185, 129, 0.1)' : isError ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
                                            padding: '2px 6px', borderRadius: '4px'
                                        }}>
                                            {log?.msg || (isSelected ? 'Ready' : 'Skipped')}
                                        </span>
                                    </div>

                                    {/* Progress Bar */}
                                    {isProcessing && (
                                        <div style={{ marginTop: '0.5rem', width: '100%', height: '4px', background: 'rgba(224, 37, 156, 0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                                            <div style={{ 
                                                width: `${log?.progress || 0}%`, 
                                                height: '100%', 
                                                background: 'var(--primary-color)',
                                                borderRadius: '2px',
                                                transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                                            }} />
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Overwrite Dialog */}
            {overwriteDialog && (
                <div className="animate-fade-in" style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(5px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99
                }}>
                    <div className="glass-panel" style={{ padding: '2rem', width: '400px', maxWidth: '90%' }}>
                        <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>File Already Exists</h3>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', wordBreak: 'break-all' }}>
                            The file usage <strong>{overwriteDialog.file}</strong> already exists in the output folder.
                        </p>
                        
                        <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <input 
                                type="checkbox" 
                                id="remember" 
                                checked={remember} 
                                onChange={e => setRemember(e.target.checked)}
                                style={{ width: '16px', height: '16px', accentColor: 'var(--primary-color)' }}
                            />
                            <label htmlFor="remember" style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', cursor: 'pointer' }}>
                                Do this for all future conflicts
                            </label>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <button className="btn-primary" onClick={() => overwriteDialog.resolve({ choice: 'overwrite', remember })}>
                                Overwrite
                            </button>
                            <button className="btn-secondary" onClick={() => overwriteDialog.resolve({ choice: 'skip', remember })}>
                                Skip This File
                            </button>
                            <button className="btn-danger" onClick={() => overwriteDialog.resolve({ choice: 'cancel', remember: false })}>
                                Cancel Process
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}

export default App;
