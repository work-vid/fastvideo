"use client";

import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Command, Child } from "@tauri-apps/plugin-shell";
import { join, basename, extname, dirname } from "@tauri-apps/api/path";
import "./App.css";
import MediaTree from "./components/MediaTree";
import { FileNode, ScanResult, ImageSettings } from "./types";

// --- Icons ---
const FolderIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>);
const PlayIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>);
const StopIcon = () => (<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="12" height="12"/></svg>);
const ChevronUp = () => (<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6"/></svg>);
const ChevronDown = () => (<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>);

function collectPaths(node: FileNode, paths: Set<string>) {
    paths.add(node.path);
    if (node.children) {
        node.children.forEach(c => collectPaths(c, paths));
    }
}

function findNode(root: FileNode, path: string): FileNode | null {
    if (root.path === path) return root;
    if (root.children) {
        for (const child of root.children) {
            const found = findNode(child, path);
            if (found) return found;
        }
    }
    return null;
}

function collectExtensions(node: FileNode, extensions: Set<string>) {
    if (node.kind === 'file') {
        const ext = node.name.split('.').pop()?.toLowerCase();
        if (ext) extensions.add(ext);
    }
    if (node.children) {
        node.children.forEach(c => collectExtensions(c, extensions));
    }
}

function filterTree(node: FileNode, enabledExtensions: Set<string>): FileNode | null {
    if (node.kind === 'file') {
        const ext = node.name.split('.').pop()?.toLowerCase();
        // If it's a file, keep it only if extension is enabled
        return (ext && enabledExtensions.has(ext)) ? node : null;
    }
    
    // If it's a folder, filter its children
    if (node.children) {
        const filteredChildren = node.children
            .map(c => filterTree(c, enabledExtensions))
            .filter((c): c is FileNode => c !== null);
            
        // Keep folder if it has visible children
        if (filteredChildren.length > 0) {
            return { ...node, children: filteredChildren };
        }
    }
    
    return null;
}

interface LogEntry {
    msg: string;
    type: 'info' | 'success' | 'error' | 'process';
    timestamp: number;
}

function App() {
    // Project State
    const [projectRoot, setProjectRoot] = useState<string | null>(null);
    const [scanResult, setScanResult] = useState<ScanResult | null>(null);
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    
    // Filter State
    const [availableExtensions, setAvailableExtensions] = useState<Set<string>>(new Set());
    const [enabledExtensions, setEnabledExtensions] = useState<Set<string>>(new Set());
    
    // Processing State
    const [processing, setProcessing] = useState(false);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [progress, setProgress] = useState(0); // Overall
    const [fileProgress, setFileProgress] = useState(0); // Current File
    const [currentFile, setCurrentFile] = useState<string>("");
    
    // Mode State
    const [optMode, setOptMode] = useState<'project' | 'folder'>('project');

    
    const [imgSettings, setImgSettings] = useState<ImageSettings>({
        convert_png: true,
        convert_jpg: true,
        quality: 90
    });





    // ...


    
    // Refs
    const abortRef = useRef(false);
    const currentChildRef = useRef<Child | null>(null);
    
    const addLog = (msg: string, type: LogEntry['type'] = 'info') => {
        setLogs(prev => [...prev, { msg, type, timestamp: Date.now() }]);
        // Auto scroll? implemented via CSS flex direction column-reverse usually or ref
    };

    // Zip State
    const [zipSource, setZipSource] = useState<string | null>(null);



    const selectInput = async (type: 'dir' | 'file') => {
        const selected = await open({ 
            directory: type === 'dir', 
            multiple: false,
            filters: type === 'file' ? [{ name: 'Baetho Projects', extensions: ['prj', 'exp'] }] : undefined
        });

        if (selected && typeof selected === 'string') {
            setProjectRoot(null);
            setScanResult(null);
            setSelectedPaths(new Set());
            setLogs([]);
            setZipSource(null);

            let rootToScan = selected;

            if (type === 'file') {
                setOptMode('project');
                addLog(`Archive selected: ${basename(selected)}`, 'info');
                addLog(`Extracting...`, 'process');
                
                const parentDir = await dirname(selected);
                const name = await basename(selected);
                const extractPath = await join(parentDir, `_baetho_temp_${Date.now()}_${name.replace(/[^a-z0-9]/gi, '_')}`);
                
                try {
                    await invoke("extract_zip", { zipPath: selected, destPath: extractPath });
                    rootToScan = extractPath;
                    setZipSource(selected);
                    addLog(`Extracted to temp: ${extractPath}`, 'success');
                } catch (e) {
                    addLog(`Extraction failed: ${e}`, 'error');
                    return;
                }
            } else {
                setOptMode('folder');
            }

            setProjectRoot(rootToScan);
            addLog(`Scanning ${type === 'file' ? 'project' : 'folder'}: ${rootToScan}`, 'info');
            
            try {
                // Pass general_mode: true if type is dir (folder mode)
                const isGeneral = type === 'dir';
                const result = await invoke<ScanResult>("scan_project", { root: rootToScan, generalMode: isGeneral });
                setScanResult(result);
                
                // Calculate Extensions
                if (result.media) {
                    const exts = new Set<string>();
                    collectExtensions(result.media, exts);
                    setAvailableExtensions(exts);
                    setEnabledExtensions(exts); // Enable all by default
                    addLog(isGeneral ? `Found files in folder.` : `Found MediaAssets tree.`, 'success');
                } else {
                    addLog(isGeneral ? `No files found.` : `No MediaAssets folder found.`, 'error');
                }
                if (!isGeneral) addLog(`Found ${result.xmls.length} XML files.`, 'info');
            } catch (e) {
                addLog(`Scan failed: ${e}`, 'error');
            }
        }
    }
    



    const handleTreeToggle = (path: string, selected: boolean) => {
        if (!scanResult?.media) return;
        
        const node = findNode(scanResult.media, path);
        if (!node) return;

        const next = new Set(selectedPaths);
        const pathsToToggle = new Set<string>();
        collectPaths(node, pathsToToggle);

        if (selected) {
            pathsToToggle.forEach(p => next.add(p));
        } else {
            pathsToToggle.forEach(p => next.delete(p));
        }
        setSelectedPaths(next);
    };



    const runOptimizer = async () => {
        if (!projectRoot || !scanResult || selectedPaths.size === 0) return;
        setProcessing(true);
        abortRef.current = false;
        setProgress(0);
        
        let targetRoot = "";
        let optimizedMediaAssets = "";

        // 1. Setup Target Paths
        if (optMode === 'folder') {
            const parent = await dirname(projectRoot);
            const name = await basename(projectRoot);
            targetRoot = await join(parent, `${name}-optimized`);
            optimizedMediaAssets = targetRoot; 
        } else {
            targetRoot = await join(projectRoot, "Optimized");
            optimizedMediaAssets = await join(targetRoot, "MediaAssets");
        }

        // Ensure Target Root Exists
        await invoke("ensure_dir", { path: targetRoot });

        const mappings: Array<{ old_virtual_path: string, new_virtual_path: string }> = [];
        const processedSourceFiles: string[] = [];
        
        // Filter only files from the tree (ignore folders in the set for processing loop)
        const filesToProcess = Array.from(selectedPaths).filter(p => {
            const node = findNode(scanResult.media!, p);
            return node && node.kind === 'file' && node.media_type && (node.media_type === 'image' || node.media_type === 'video');
        });

        // Smart Count Filter (verify enabled extensions)
        const validFiles = filesToProcess.filter(p => {
             const node = findNode(scanResult.media!, p);
             const ext = node?.name.split('.').pop()?.toLowerCase();
             return ext && enabledExtensions.has(ext);
        });

        let completed = 0;
        
        // 2. OPTIMIZATION PHASE
        for (const inputPath of validFiles) {
            if (abortRef.current) break;

            const node = findNode(scanResult.media!, inputPath);
            if (!node) continue;
            
            addLog(`Optimizing: ${node.name}`, 'process');
            setCurrentFile(node.name);

            try {
                // Calculate Target Path
                let relativeAbs = inputPath.replace(projectRoot, ""); 
                relativeAbs = relativeAbs.replace(/^[/\\]+/, "");
                
                let targetFile = await join(targetRoot, relativeAbs);
                
                // Ensure parent directory exists (Crucial since we haven't copied tree yet)
                const parentDir = await dirname(targetFile);
                await invoke("ensure_dir", { path: parentDir });
                
                // Determine format
                const ext = await extname(inputPath);
                const isImage = node.media_type === 'image';
                const isVideo = node.media_type === 'video';
                
                let finalPath = targetFile; 
                let converted = false;

                if (isImage) {
                    const isPng = ext.toLowerCase() === 'png';
                    const isJpg = ['jpg', 'jpeg'].includes(ext.toLowerCase());
                    
                    if ((isPng && imgSettings.convert_png) || (isJpg && imgSettings.convert_jpg)) {
                         // Convert to WebP
                         finalPath = await join(parentDir, await basename(targetFile, "." + ext) + ".webp");
                         
                         const args = [
                             "-y",
                             "-i", inputPath, 
                             "-c:v", "libwebp",
                             "-q:v", imgSettings.quality.toString(),
                             finalPath 
                         ];
                         
                         await runFfmpeg(args, (p) => setFileProgress(p));
                         setFileProgress(100);
                         converted = true;
                    }
                } else if (isVideo) {
                    finalPath = await join(parentDir, await basename(targetFile, "." + ext) + ".mp4");
                    
                    let args: string[] = [];
                    
                     if (imgSettings.videoOverride && imgSettings.videoOverride.trim().length > 0) {
                         // 1. Determine Output Path based on extension in command
                         let currentFinalPath = finalPath;
                         const extMatch = imgSettings.videoOverride.match(/{output}(\.[a-zA-Z0-9]+)/);
                         if (extMatch) {
                             const newExt = extMatch[1];
                             currentFinalPath = currentFinalPath.replace(/\.mp4$/, newExt);
                             finalPath = currentFinalPath; // Update the main variable for downstream logic
                         }

                         // 2. Prepare Command for Tokenization
                         // We use safe placeholders preventing space-splitting issues
                         const PLACEHOLDER_INPUT = "___INPUT_FILE_TOKEN___";
                         const PLACEHOLDER_OUTPUT = "___OUTPUT_FILE_TOKEN___";

                         // Replace user tags with safe tokens
                         // We handle {output}.ext by replacing the whole thing with the token
                         let cmdStr = imgSettings.videoOverride
                            .replace(/{input}/g, PLACEHOLDER_INPUT)
                            .replace(/{output}(\.[a-zA-Z0-9]+)/g, PLACEHOLDER_OUTPUT) 
                            .replace(/{output}/g, PLACEHOLDER_OUTPUT);

                         // 3. Tokenize (Split by spaces while respecting quotes)
                         const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
                         const matches = [];
                         let match;
                         while ((match = regex.exec(cmdStr)) !== null) {
                             if (match[1]) matches.push(match[1]);
                             else if (match[2]) matches.push(match[2]);
                             else matches.push(match[0]);
                         }
                         args = matches;

                         // 4. Clean up args
                         if (args.length > 0 && args[0].toLowerCase() === 'ffmpeg') {
                             args.shift();
                         }

                         // 5. Restore Paths
                         args = args.map(arg => {
                             if (arg === PLACEHOLDER_INPUT) return inputPath;
                             if (arg === PLACEHOLDER_OUTPUT) return currentFinalPath;
                             // Handle cases where user might have attached flags? unlikely if spaces correct
                             // But mostly just exact match replacement
                             return arg
                                .replace(PLACEHOLDER_INPUT, inputPath)
                                .replace(PLACEHOLDER_OUTPUT, currentFinalPath);
                         });
                         
                         // 6. Ensure Overwrite (-y)
                         if (!args.includes('-y')) {
                             args.unshift('-y');
                         }
                         
                    } else {
                        // Default Logic
                        args = [
                            "-y", 
                            "-i", inputPath, 
                            "-c:v", "libx265",
                            "-crf", "23",
                            "-preset", "fast",
                            "-c:a", "aac",
                            "-b:a", "128k",
                            "-tag:v", "hvc1",
                            finalPath 
                        ];
                    }
                    
                    setFileProgress(0);
                    await runFfmpeg(args, (p) => setFileProgress(p));
                    setFileProgress(100);
                    converted = true;
                }
                
                // If we didn't convert (e.g. extension not selected for conversion but selected for tree?),
                // we should copy it manually?
                // Actually, `validFiles` implies we intend to process it.
                // If it falls through (e.g. an XML selected in tree??), we might need to handle copy.
                // But filter says `image` or `video`.
                // If logic falls through (e.g. keep PNG as PNG), we need to copy it here ourselves
                // OR relies on `copy_project` to catch it?
                // IF we want `copy_project` to catch it, we DO NOT add to `processedSourceFiles`.
                // IF we want to move it ourselves, we do.
                
                if (!converted) {
                    // We are in "Optimization Phase". If we don't optimize, we leave it for the Copy Phase?
                    // YES.
                } else {
                    processedSourceFiles.push(inputPath);
                    
                    if (optMode === 'project') {
                        const mediaAssetsPath = await join(projectRoot, "MediaAssets");
                        const oldRel = inputPath.replace(mediaAssetsPath, "").replace(/\\/g, "/");
                        const newRel = finalPath.replace(optimizedMediaAssets, "").replace(/\\/g, "/");
                        
                        if (oldRel !== newRel) {
                            mappings.push({
                                old_virtual_path: oldRel, 
                                new_virtual_path: newRel
                            });
                        }
                    }
                }
                
            } catch (e) {
                addLog(`Error processing ${node.name}: ${e}`, 'error');
            }
            
            completed++;
            setProgress((completed / validFiles.length) * 100);
        }

        // 3. COPY PHASE (Project Mode Only)
        if (optMode === 'project' && !abortRef.current) {
            addLog(`Copying remaining project files...`, 'process');
            setCurrentFile("Syncing structure...");
            try {
                 await invoke("copy_project", { 
                     source: projectRoot, 
                     target: targetRoot,
                     excludes: processedSourceFiles 
                 });
                 addLog(`Structure synced.`, 'success');
            } catch (e) {
                 addLog(`Copy failed: ${e}`, 'error');
                 setProcessing(false);
                 return;
            }
        }

        // XML Updates in TARGET (Only Project Mode)
        if (optMode === 'project' && mappings.length > 0 && !abortRef.current) {
// ... existing XML logic ...
            addLog(`Updating references in XML files...`, 'process');
            
            // Map original XML paths to Target XML paths
            const targetXmls = [];
            for (const origXml of scanResult.xmls) {
                 const rel = origXml.replace(projectRoot, "");
                 const targetXml = await join(targetRoot, rel);
                 targetXmls.push(targetXml);
            }

            try {
                const count = await invoke<number>("update_xml_refs", { 
                    mappings, 
                    xmlPaths: targetXmls 
                });
                addLog(`Updated ${count} XML files.`, 'success');
            } catch (e) {
                addLog(`XML Update Failed: ${e}`, 'error');
            }
        }
        
        // Zip Repacking (Only Project Mode)
        if (optMode === 'project' && zipSource && !abortRef.current) {
            addLog("Repacking optimized project...", 'process');
            setCurrentFile("Archiving... (This may take a while)");
            setFileProgress(100); 

            try {
                const ext = await extname(zipSource);
                const parent = await dirname(zipSource);
                const name = await basename(zipSource, "." + ext);
                const finalZip = await join(parent, `${name}-optimized.${ext}`);
                
                await invoke("compress_zip", { sourceDir: targetRoot, zipPath: finalZip });
                addLog(`Archive saved: ${finalZip}`, 'success');
                
                // Cleanup Temp
                addLog("Cleaning up temp files...", 'info');
                await invoke("delete_dir", { path: projectRoot }); 
                
            } catch (e) {
                addLog(`Repack failed: ${e}`, 'error');
            }
        }
        
        setProcessing(false);
        addLog("Optimization Complete!", 'success');
        if (optMode === 'folder') {
             addLog(`Output folder ready: ${targetRoot}`, 'success');
             // Open folder?
             // await invoke("open_folder", { path: targetRoot }); // if exists
        } else if (!zipSource) {
            addLog(`Output available in: ${targetRoot}`, 'success');
        }
    };

    const runFfmpeg = async (args: string[], onProgress?: (p: number) => void) => {
        const command = Command.sidecar("binaries/ffmpeg", args);
        
        // Parsing State
        let duration = 0;
        
        command.stderr.on("data", (line) => {
            // FFmpeg stats often come in chunks, sometimes split.
            const durMatch = line.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
            if (durMatch) {
                const [_, h, m, s] = durMatch;
                duration = parseFloat(h) * 3600 + parseFloat(m) * 60 + parseFloat(s);
            }
            
            const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
            if (timeMatch && duration > 0) {
                const [_, h, m, s] = timeMatch;
                const current = parseFloat(h) * 3600 + parseFloat(m) * 60 + parseFloat(s);
                const percent = Math.min(100, (current / duration) * 100);
                if (onProgress) onProgress(percent);
            }
        });

        const child = await command.spawn();
        currentChildRef.current = child;
        
        return new Promise<void>((resolve, reject) => {
            command.on("close", (data) => {
                if (data.code === 0) resolve();
                else reject(`FFmpeg exited with ${data.code}`);
            });
            command.on("error", (e) => reject(e));
        });
    };

    const cancel = async () => {
        abortRef.current = true;
        if (currentChildRef.current) {
            await currentChildRef.current.kill();
        }
        setProcessing(false);
        addLog("Cancelled by user.", 'error');
    };

    const toggleExtension = (ext: string) => {
        const next = new Set(enabledExtensions);
        if (next.has(ext)) next.delete(ext);
        else next.add(ext);
        setEnabledExtensions(next);
    };

    const getSelectedFileCount = () => {
        if (!scanResult?.media) return 0;
        let count = 0;
        const traverse = (node: FileNode) => {
            if (node.kind === 'file') {
                 const ext = node.name.split('.').pop()?.toLowerCase();
                 // Must be selected AND enabled
                 if (selectedPaths.has(node.path) && ext && enabledExtensions.has(ext)) {
                     count++;
                 }
            }
            if (node.children) node.children.forEach(traverse);
        };
        // We traverse the FULL tree, but only count if selected & enabled.
        // Or simpler: Iterate selected paths? 
        // Iterate selectedPaths is O(N_selected). Finding node is O(Tree). 
        // Traversing visible tree is safer.
        
        // Actually, we can just iterate the selectedPaths set, find the node, check if enabled.
        // But finding node is expensive if map not built.
        // Let's traverse the `filteredTree`?
        // Let's traverse the full tree and specific check.
        traverse(scanResult.media);
        return count;
    };

    const filteredTree = scanResult?.media ? filterTree(scanResult.media, enabledExtensions) : null;

    return (
        <main className="app-container">
            {/* Left Panel: Tree & Project */}
            <div className="left-panel">
                <div className="header-simple">
                     <h2>Baetho Optimizer</h2>
                </div>
                
                <div className="project-controls">
                     {!projectRoot ? (
                         <div style={{display:'flex', gap:'0.5rem', width:'100%'}}>
                             <button className="btn-outline" style={{flex:1}} onClick={() => selectInput('dir')}>Folder</button>
                             <button className="btn-outline" style={{flex:1}} onClick={() => selectInput('file')}>Project</button>
                         </div>
                     ) : (
                         <div className="project-info">
                             <div className="path">{projectRoot.split(/[/\\]/).pop()}</div>
                             <button className="btn-icon" onClick={() => setProjectRoot(null)} title="Change Project"><FolderIcon/></button>
                         </div>
                     )}
                </div>


                {/* Filter Chips */}
                {availableExtensions.size > 0 && (
                    <div className="filter-chips glass-panel" style={{marginBottom:'1rem', padding:'0.75rem', display:'flex', gap:'0.5rem', flexWrap:'wrap'}}>
                        {Array.from(availableExtensions).map(ext => (
                            <button 
                                key={ext} 
                                className={`chip ${enabledExtensions.has(ext) ? 'active' : ''}`}
                                onClick={() => toggleExtension(ext)}
                                style={{
                                    fontSize: '0.75rem',
                                    padding: '0.25rem 0.75rem',
                                    borderRadius: '1rem',
                                    background: enabledExtensions.has(ext) ? 'var(--primary-color)' : 'rgba(255,255,255,0.1)',
                                    color: enabledExtensions.has(ext) ? 'white' : 'var(--text-secondary)',
                                    border: '1px solid var(--border-color)'
                                }}
                            >
                                {ext.toUpperCase()}
                            </button>
                        ))}
                    </div>
                )}

                <div className="tree-container glass-panel">
                    {filteredTree ? (
                         <MediaTree 
                            node={filteredTree} 
                            selectedPaths={selectedPaths} 
                            onToggle={handleTreeToggle} 
                         />
                    ) : (
                        <div className="empty-state">
                            {scanResult?.media ? "No files match current filters" : "No MediaAssets loaded"}
                        </div>
                    )}
                </div>
                
                <div className="action-bar">
                    {processing ? (
                        <button className="btn-danger full-width" onClick={cancel}><StopIcon/> Stop</button>
                    ) : (
                        <button className="btn-primary full-width" onClick={runOptimizer} disabled={selectedPaths.size === 0 || getSelectedFileCount() === 0}>
                            <PlayIcon/> Optimize ({getSelectedFileCount()})
                        </button>
                    )}
                </div>
            </div>

            {/* Right Panel: Settings & Console */}
            <div className="right-panel">
                 <div className="settings-section glass-panel">
                     <h3>Image Settings</h3>
                     <div className="setting-row">
                         <label>Convert PNG to WebP</label>
                         <input type="checkbox" checked={imgSettings.convert_png} onChange={e => setImgSettings({...imgSettings, convert_png: e.target.checked})} />
                     </div>
                     <div className="setting-row">
                         <label>Convert JPG to WebP</label>
                         <input type="checkbox" checked={imgSettings.convert_jpg} onChange={e => setImgSettings({...imgSettings, convert_jpg: e.target.checked})} />
                     </div>
                     <div className="setting-row">
                          <label>Quality (0-100)</label>
                          <div className="number-control">
                              <input 
                                  type="number" 
                                  className="input-number no-spinner"
                                  min="1" 
                                  max="100" 
                                  value={imgSettings.quality === 0 ? '' : imgSettings.quality} 
                                  onChange={e => {
                                      const val = e.target.value === '' ? 0 : parseInt(e.target.value);
                                      setImgSettings({...imgSettings, quality: Math.min(100, Math.max(0, val))}); // Allow 0 typing temporarily
                                  }} 
                                  onBlur={() => {
                                       // Enforce min 1 on blur
                                       if (imgSettings.quality < 1) setImgSettings({...imgSettings, quality: 75});
                                  }}
                              />
                              <div className="spin-btns">
                                  <button onClick={() => setImgSettings(s => ({...s, quality: Math.min(100, s.quality + 1)}))} className="spin-btn up"><ChevronUp/></button>
                                  <button onClick={() => setImgSettings(s => ({...s, quality: Math.max(1, s.quality - 1)}))} className="spin-btn down"><ChevronDown/></button>
                              </div>
                          </div>
                     </div>
                     
                     <div className="setting-row" style={{flexDirection:'column', alignItems:'flex-start', gap:'0.5rem'}}>
                         <label>Video Command Override <span style={{fontSize:'0.7rem', opacity:0.7}}>(optional)</span></label>
                         <textarea 
                             className="input-textarea"
                             placeholder="-c:v libx265 -crf 28 ... {input} {output}"
                             value={imgSettings.videoOverride || ''}
                             onChange={e => setImgSettings({...imgSettings, videoOverride: e.target.value})}
                         />
                         <div style={{fontSize:'0.65rem', color:'var(--text-secondary)'}}>
                             Use <code>{'{input}'}</code> and <code>{'{output}'}</code> as placeholders. 
                             Leave empty for default H.265 optimization.
                         </div>
                     </div>
                 </div>

                 <div className="console-section glass-panel">
                     <h3>Log</h3>
                     <div className="console-output">
                         {logs.map((l, i) => (
                             <div key={i} className={`log-line ${l.type}`}>
                                 <span className="time">{new Date(l.timestamp).toLocaleTimeString()}</span>
                                 <span className="msg">{l.msg}</span>
                             </div>
                         ))}
                     </div>
                 </div>

                 {processing && (
                     <div className="status-section glass-panel">
                         <h3>Status</h3>
                         <div className="status-content">
                             <div className="progress-group">
                                 <div className="progress-header" style={{display:'flex', justifyContent:'space-between', fontSize:'0.8rem', marginBottom:'0.25rem'}}>
                                     <span className="label">Processing: <strong>{currentFile}</strong></span>
                                     <span className="value">{currentFile.startsWith("Archiving") ? "" : `${Math.round(fileProgress)}%`}</span>
                                 </div>
                                 <div className="progress-bar-container">
                                     <div 
                                         className="progress-bar" 
                                         style={{ 
                                             width: `${fileProgress}%`, 
                                             backgroundColor: 'var(--accent-secondary)' 
                                         }}
                                     ></div>
                                 </div>
                             </div>

                             <div className="progress-group" style={{marginTop: '1rem'}}>
                                 <div className="progress-header" style={{display:'flex', justifyContent:'space-between', fontSize:'0.8rem', marginBottom:'0.25rem'}}>
                                     <span className="label">Overall Progress</span>
                                     <span className="value">{currentFile.startsWith("Archiving") ? "" : `${Math.round(progress)}%`}</span>
                                 </div>
                                 <div className="progress-bar-container">
                                     <div 
                                         className={`progress-bar ${currentFile.startsWith("Archiving") ? 'indeterminate' : ''}`}
                                         style={{ 
                                              width: `${progress}%`,
                                              backgroundColor: currentFile.startsWith("Archiving") ? undefined : undefined // allow CSS default 
                                         }}
                                     ></div>
                                 </div>
                             </div>
                         </div>
                     </div>
                 )}
            </div>
        </main>
    );
}

export default App;
