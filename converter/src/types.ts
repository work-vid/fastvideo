export interface FileNode {
    path: string;
    name: string;
    kind: "file" | "dir";
    children?: FileNode[];
    media_type?: "image" | "video" | "xml";
}

export interface ScanResult {
    media?: FileNode;
    xmls: string[];
}

export interface ImageSettings {
    convert_png: boolean;
    convert_jpg: boolean;
    quality: number;
}
