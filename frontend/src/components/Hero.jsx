
import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import RotatingText from './RotatingText';
import GridMotion from './GridMotion';
import './Hero.css';

gsap.registerPlugin(ScrollTrigger);

export default function Hero() {
    return (
        <div className="hero-container" style={{ background: '#000', color: '#fff', flexDirection: 'column', padding: '10vw' }}>
            <div className="hero-content" style={{ zIndex: 10 }}>
                <h1 style={{ fontSize: 'clamp(4rem, 15vw, 12rem)', letterSpacing: '-0.05em', margin: 0 }}>NEXU</h1>
                <p style={{ fontSize: 'clamp(1rem, 2vw, 1.5rem)', color: '#888', marginTop: '1rem' }}>
                    One campus, one platform.
                </p>
            </div>
            <div style={{ marginTop: '4rem', zIndex: 10 }}>
                <h2 style={{ fontSize: 'clamp(1.5rem, 3.5vw, 2.5rem)', fontWeight: 400, color: '#ccc' }}>
                    Redefining Communication and Tracking for Students
                </h2>
            </div>
        </div>
    );
}

