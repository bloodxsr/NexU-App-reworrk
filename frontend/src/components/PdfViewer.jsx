import { GoDownload } from 'react-icons/go';

export default function PdfViewer({ resource, onDownload, onClose }) {
    if (!resource) return null;

    return (
        <div className="pdf-viewer-overlay">
            <div className="pdf-viewer-header">
                <h2>{resource.title}</h2>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button className="module-btn" onClick={() => onDownload(resource)}>
                        <GoDownload /> Download File
                    </button>
                    <button className="module-btn ghost" onClick={onClose}>
                        Close Viewer
                    </button>
                </div>
            </div>
            <div className="pdf-viewer-body">
                <iframe
                    src={resource.file_url}
                    title={resource.title}
                    data-lenis-prevent
                />
            </div>
        </div>
    );
}
