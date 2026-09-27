import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './LogoLoop.css';

export default function LogoLoop({
    logos = [],
    speed = 80,
    direction = 'left',
    width = '100%',
    logoHeight = 34,
    gap = 14,
    pauseOnHover = true,
    scaleOnHover = true,
    fadeOut = true,
    fadeOutColor = '#000',
    ariaLabel = 'Logo loop',
    className = '',
    style = {},
}) {
    const containerRef = useRef(null);
    const trackRef = useRef(null);
    const [duration, setDuration] = useState(24);

    const isHorizontal = direction === 'left' || direction === 'right';
    const isReverse = direction === 'right' || direction === 'down';

    const computeDuration = useCallback(() => {
        if (!trackRef.current || speed <= 0) return;
        const total = isHorizontal ? trackRef.current.scrollWidth : trackRef.current.scrollHeight;
        const singleLane = total / 2;
        if (singleLane > 0) {
            setDuration(singleLane / speed);
        }
    }, [isHorizontal, speed]);

    useEffect(() => {
        computeDuration();
        window.addEventListener('resize', computeDuration);
        return () => window.removeEventListener('resize', computeDuration);
    }, [computeDuration]);

    const maskStyle = useMemo(() => {
        if (!fadeOut) return {};
        if (isHorizontal) {
            return {
                WebkitMaskImage: `linear-gradient(to right, transparent, ${fadeOutColor} 12%, ${fadeOutColor} 88%, transparent)`,
                maskImage: `linear-gradient(to right, transparent, ${fadeOutColor} 12%, ${fadeOutColor} 88%, transparent)`,
            };
        }
        return {
            WebkitMaskImage: `linear-gradient(to bottom, transparent, ${fadeOutColor} 12%, ${fadeOutColor} 88%, transparent)`,
            maskImage: `linear-gradient(to bottom, transparent, ${fadeOutColor} 12%, ${fadeOutColor} 88%, transparent)`,
        };
    }, [fadeOut, fadeOutColor, isHorizontal]);

    const loopItems = [...logos, ...logos];

    return (
        <div
            ref={containerRef}
            className={`logo-loop ${isHorizontal ? 'logo-loop--x' : 'logo-loop--y'} ${pauseOnHover ? 'logo-loop--pause' : ''} ${scaleOnHover ? 'logo-loop--scale' : ''} ${className}`}
            style={{ width, ...maskStyle, ...style }}
            aria-label={ariaLabel}
        >
            <div
                ref={trackRef}
                className={`logo-loop-track ${isReverse ? 'is-reverse' : ''}`}
                style={{
                    '--logo-gap': `${gap}px`,
                    '--logo-height': `${logoHeight}px`,
                    '--loop-duration': `${duration}s`,
                }}
            >
                {loopItems.map((logo, idx) => {
                    const key = `${idx}-${logo.alt || logo.title || 'logo'}`;
                    const content = logo.node ? (
                        logo.node
                    ) : (
                        <img
                            src={logo.src}
                            alt={logo.alt || 'logo'}
                            srcSet={logo.srcSet}
                            sizes={logo.sizes}
                            width={logo.width}
                            height={logo.height}
                        />
                    );

                    const item = logo.href ? (
                        <a href={logo.href} aria-label={logo.ariaLabel || logo.title || logo.alt || 'logo'} title={logo.title}>
                            {content}
                        </a>
                    ) : (
                        content
                    );

                    return (
                        <div className="logo-loop-item" key={key}>
                            {item}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
