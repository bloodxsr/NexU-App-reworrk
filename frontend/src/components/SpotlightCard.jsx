import './SpotlightCard.css';

const SpotlightCard = ({ children, className = '' }) => {
    return (
        <div className={`card-spotlight ${className}`}>
            {children}
        </div>
    );
};

export default SpotlightCard;
