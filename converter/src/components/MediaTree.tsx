"use client";
import { useState } from 'react';
import { FileNode } from '../types';
import './MediaTree.css';

interface MediaTreeProps {
    node: FileNode;
    selectedPaths: Set<string>;
    onToggle: (path: string, selected: boolean) => void;
    level?: number;
}

export default function MediaTree({ node, selectedPaths, onToggle, level = 0 }: MediaTreeProps) {
    const [expanded, setExpanded] = useState(true);

    const isFolder = node.kind === 'dir';
    const isSelected = selectedPaths.has(node.path);
    
    // Check if some children are selected (for indeterminate state visual, simpler logic for now)
    // const hasSelectedChildren = node.children?.some(c => selectedPaths.has(c.path) || (c.children && ...));

    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        onToggle(node.path, !isSelected);
    };

    const handleExpand = (e: React.MouseEvent) => {
        e.stopPropagation();
        setExpanded(!expanded);
    };

    const getIcon = () => {
        if (isFolder) return expanded ? '📂' : '📁';
        if (node.media_type === 'image') return '🖼️';
        if (node.media_type === 'video') return '🎬';
        if (node.media_type === 'xml') return '📄';
        return '📄';
    };

    return (
        <div className="tree-node" style={{ marginLeft: `${level * 20}px` }}>
            <div className={`node-content ${isSelected ? 'selected' : ''}`} onClick={isFolder ? handleExpand : handleToggle}>
                <div className="checkbox-wrapper" onClick={handleToggle}>
                    <div className={`custom-checkbox ${isSelected ? 'checked' : ''}`}>
                        {isSelected && <svg viewBox="0 0 24 24" width="12" height="12" fill="white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
                    </div>
                </div>
                
                <span className="node-icon">{getIcon()}</span>
                <span className="node-name">{node.name}</span>
                {node.media_type && <span className="node-type-badge">{node.media_type}</span>}
            </div>
            
            {isFolder && expanded && node.children && (
                <div className="node-children">
                    {node.children.map((child) => (
                        <MediaTree 
                            key={child.path} 
                            node={child} 
                            selectedPaths={selectedPaths} 
                            onToggle={onToggle}
                            level={0} // CSS margin handles indent via parent div? No, recursive structure usually needs context or clean CSS.
                                      // Actually, putting margin on parent div works recursively.
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
