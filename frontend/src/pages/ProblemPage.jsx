import React from 'react';

export default function ProblemPage() {
    return (
        <div style={{ padding: '4rem 10vw', maxWidth: '1200px', margin: '0 auto', color: '#fff' }}>
            <h1 style={{ fontSize: '3rem', borderBottom: '1px solid #333', paddingBottom: '1rem', marginBottom: '3rem' }}>The Problem</h1>
            
            <section style={{ marginBottom: '4rem' }}>
                <h2 style={{ fontSize: '1.5rem', color: '#ccc', marginBottom: '1.5rem' }}>Fragmentation in Campus Life</h2>
                <p style={{ fontSize: '1.2rem', lineHeight: '1.8', color: '#aaa', maxWidth: '800px' }}>
                    Modern universities run on a messy web of disconnected tools. Students are expected to track their attendance on one portal, submit assignments on another, check announcements on WhatsApp, and find resources on an outdated library website. This fragmentation leads to missed deadlines, increased anxiety, and a loss of focus on actual academics.
                </p>
            </section>

            <section style={{ marginBottom: '4rem' }}>
                <h2 style={{ fontSize: '1.5rem', color: '#ccc', marginBottom: '1.5rem' }}>The Disconnect</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
                    <div style={{ border: '1px solid #333', padding: '2rem' }}>
                        <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>Communication</h3>
                        <p style={{ color: '#aaa', lineHeight: '1.6' }}>Important announcements from faculty get buried under hundreds of informal messages in unauthorized chat groups.</p>
                    </div>
                    <div style={{ border: '1px solid #333', padding: '2rem' }}>
                        <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>Academics</h3>
                        <p style={{ color: '#aaa', lineHeight: '1.6' }}>Students lack a unified view of their academic standing, making it hard to predict how one missed class affects their overall eligibility.</p>
                    </div>
                    <div style={{ border: '1px solid #333', padding: '2rem' }}>
                        <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>Resources</h3>
                        <p style={{ color: '#aaa', lineHeight: '1.6' }}>Syllabi, past year questions (PYQs), and lecture notes are scattered across various Google Drives and physical copies.</p>
                    </div>
                </div>
            </section>
        </div>
    );
}
