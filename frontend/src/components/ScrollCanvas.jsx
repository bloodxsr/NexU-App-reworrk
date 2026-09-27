import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './ScrollCanvas.css';

gsap.registerPlugin(ScrollTrigger);

const FRAME_COUNT = 240;
const FRAME_PATH = (n) => `/ANIMATED /ezgif-frame-${String(n).padStart(3, '0')}.jpg`;

function preloadImages(count) {
    const images = [];
    for (let i = 1; i <= count; i++) {
        const img = new Image();
        img.src = FRAME_PATH(i);
        images.push(img);
    }
    return images;
}

export default function ScrollCanvas() {
    return null;
    const canvasRef = useRef(null);
    const frameRef = useRef({ index: 0 });
    const imagesRef = useRef([]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const images = preloadImages(FRAME_COUNT);
        imagesRef.current = images;

        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            drawFrame(frameRef.current.index);
        }

        function drawFrame(index) {
            const img = images[index];
            if (!img || !img.complete) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Cover-fit the image on the canvas
            const scale = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
            const drawW = img.naturalWidth * scale;
            const drawH = img.naturalHeight * scale;
            const offsetX = (canvas.width - drawW) / 2;
            const offsetY = (canvas.height - drawH) / 2;
            ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
        }

        // Wait for first image to load to get dimensions
        images[0].onload = () => {
            resize();
        };
        if (images[0].complete) resize();

        window.addEventListener('resize', resize);

        const obj = frameRef.current;

        const st = ScrollTrigger.create({
            trigger: document.body,
            start: 'top top',
            end: `+=${window.innerHeight * 2.1}`,
            scrub: 0.3,
            onUpdate: (self) => {
                const rawIndex = Math.round(self.progress * (FRAME_COUNT - 1));
                const clampedIndex = Math.max(0, Math.min(FRAME_COUNT - 1, rawIndex));
                if (obj.index !== clampedIndex) {
                    obj.index = clampedIndex;
                    drawFrame(clampedIndex);
                }
            },
        });

        return () => {
            st.kill();
            window.removeEventListener('resize', resize);
        };
    }, []);

    return <canvas ref={canvasRef} className="scroll-canvas" />;
}
