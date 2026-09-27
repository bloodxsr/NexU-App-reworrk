import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './StickySection.css';

const topics = [
    {
        id: 'problem',
        number: '01.',
        text: 'Campus updates, attendance, and academic signals are still fragmented across tools. Students and faculty lose context, time, and clarity.',
        img: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&q=80&w=1200'
    },
    {
        id: 'features',
        number: '02.',
        text: 'Core features run in one flow: attendance, assignments, resources, schedules, and communication without app-hopping.',
        img: 'https://images.unsplash.com/photo-1512428559087-560fa5ceab42?auto=format&fit=crop&q=80&w=1200'
    },
    {
        id: 'tech',
        number: '03.',
        text: 'Engineered with React, Vite, Rust, and ScyllaDB for secure, reliable, real-time campus operations.',
        img: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&q=80&w=1200'
    }
];

export default function StickySection() {
    return (
        <div style={{ background: '#000', color: '#fff', padding: '10vw', display: 'flex', flexDirection: 'column', gap: '4rem' }}>
            {topics.map((topic) => (
                <div key={topic.id} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', borderTop: '1px solid #333', paddingTop: '2rem' }}>
                    <div style={{ fontSize: '2rem', color: '#888' }}>{topic.number}</div>
                    <h2 style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)', fontWeight: 400, maxWidth: '800px', lineHeight: 1.4 }}>{topic.text}</h2>
                    <Link to={`/${topic.id}`} style={{ color: '#fff', textDecoration: 'none', fontSize: '1.2rem', marginTop: '1rem', borderBottom: '1px solid #fff', width: 'fit-content', paddingBottom: '0.2rem' }}>
                        EXPLORE MORE &mdash;
                    </Link>
                </div>
            ))}
        </div>
    );
}
