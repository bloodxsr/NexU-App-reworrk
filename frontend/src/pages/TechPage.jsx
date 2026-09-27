import React from 'react';

export default function TechPage() {
    return (
        <div style={{ padding: '4rem 10vw', maxWidth: '1200px', margin: '0 auto', color: '#fff' }}>
            <h1 style={{ fontSize: '3rem', borderBottom: '1px solid #333', paddingBottom: '1rem', marginBottom: '3rem' }}>The Tech Stack</h1>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
                <div style={{ border: '1px solid #333', padding: '2rem' }}>
                    <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Frontend</h2>
                    <ul style={{ color: '#aaa', lineHeight: '2', listStyle: 'none', padding: 0 }}>
                        <li><strong style={{ color: '#fff' }}>React (Vite)</strong> - Fast, modern UI rendering.</li>
                        <li><strong style={{ color: '#fff' }}>React Router</strong> - Client-side routing.</li>
                        <li><strong style={{ color: '#fff' }}>Zustand & Context API</strong> - State management.</li>
                        <li><strong style={{ color: '#fff' }}>Vanilla CSS</strong> - Brutalist, custom-built minimalist theme.</li>
                    </ul>
                </div>

                <div style={{ border: '1px solid #333', padding: '2rem' }}>
                    <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Backend</h2>
                    <ul style={{ color: '#aaa', lineHeight: '2', listStyle: 'none', padding: 0 }}>
                        <li><strong style={{ color: '#fff' }}>Rust (Axum)</strong> - Extremely fast, memory-safe API layer.</li>
                        <li><strong style={{ color: '#fff' }}>SQLx</strong> - Asynchronous SQL database access.</li>
                        <li><strong style={{ color: '#fff' }}>Tokio</strong> - High-performance async runtime for Rust.</li>
                    </ul>
                </div>

                <div style={{ border: '1px solid #333', padding: '2rem' }}>
                    <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Infrastructure & Data</h2>
                    <ul style={{ color: '#aaa', lineHeight: '2', listStyle: 'none', padding: 0 }}>
                        <li><strong style={{ color: '#fff' }}>PostgreSQL</strong> - Primary relational database.</li>
                        <li><strong style={{ color: '#fff' }}>ScyllaDB</strong> - NoSQL datastore for high-throughput logging.</li>
                        <li><strong style={{ color: '#fff' }}>Redis</strong> - Caching layer for session tokens and high-speed lookups.</li>

                        <li><strong style={{ color: '#fff' }}>Docker</strong> - Containerized deployment and orchestration.</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
