import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import './ContentSection.css';

export default function ContentSection({ title, imageSrc, reversed }) {
    const sectionRef = useRef(null);
    const imageRef = useRef(null);

    useEffect(() => {
        let ctx = gsap.context(() => {
            // Parallax effect on image
            gsap.from(imageRef.current, {
                scrollTrigger: {
                    trigger: sectionRef.current,
                    start: 'top bottom',
                    end: 'bottom top',
                    scrub: true,
                },
                y: -100,
                scale: 1.15,
                ease: 'none'
            });

            // Text fade up
            gsap.from('.content-text', {
                scrollTrigger: {
                    trigger: sectionRef.current,
                    start: 'top 80%',
                },
                y: 50,
                opacity: 0,
                duration: 1,
                ease: 'power3.out'
            });

        }, sectionRef);

        return () => ctx.revert();
    }, []);

    return (
        <section className={`content-section ${reversed ? 'reversed' : ''}`} ref={sectionRef}>
            <div className="content-text">
                <h2>{title}</h2>
                <p>A documentary exploring the edges of what we know in a society headed towards self-destruction. A quest for hope.</p>
            </div>
            <div className="content-image-wrapper">
                <img ref={imageRef} src={imageSrc} alt={title} />
            </div>
        </section>
    );
}
