import React from 'react';

export default function FeaturesPage() {
    return (
        <div style={{ padding: '4rem 10vw', maxWidth: '1200px', margin: '0 auto', color: '#fff' }}>
            <h1 style={{ fontSize: '3rem', borderBottom: '1px solid #333', paddingBottom: '1rem', marginBottom: '3rem' }}>Core Features</h1>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
                <section style={{ border: '1px solid #333', padding: '3rem' }}>
                    <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }}>01 / Unified Attendance</h2>
                    <p style={{ fontSize: '1.1rem', color: '#aaa', lineHeight: '1.6', maxWidth: '800px', marginBottom: '1.5rem' }}>
                        A seamless, zero-friction attendance tracking system. Teachers can mark presence in seconds, and students can instantly see their status, warning thresholds, and semester-wide analytics.
                    </p>
                    <ul style={{ color: '#888', marginLeft: '1.5rem', lineHeight: '1.8' }}>
                        <li>Real-time tracking and dashboard synchronization.</li>
                        <li>Automated absence warnings when approaching minimum thresholds.</li>
                        <li>Instant medical leave application and approval workflow.</li>
                    </ul>
                </section>

                <section style={{ border: '1px solid #333', padding: '3rem' }}>
                    <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }}>02 / Academic Resource Hub</h2>
                    <p style={{ fontSize: '1.1rem', color: '#aaa', lineHeight: '1.6', maxWidth: '800px', marginBottom: '1.5rem' }}>
                        A centralized library for all syllabi, past year questions (PYQs), and lecture notes. Neatly organized by semester, subject, and resource type.
                    </p>
                    <ul style={{ color: '#888', marginLeft: '1.5rem', lineHeight: '1.8' }}>
                        <li>Built-in PDF viewer for immediate reading.</li>
                        <li>Role-based access: teachers upload directly, students consume.</li>
                        <li>No more hunting for drive links before exams.</li>
                    </ul>
                </section>
            </div>
        </div>
    );
}
