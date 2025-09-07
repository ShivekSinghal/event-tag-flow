import { useState, useCallback } from "react";
import { FlyingCard } from "@/components/ui/flying-card";

interface FlyingCardData {
  id: string;
  amount: number;
  name: string;
  studio: string;
  type: "topup" | "sale";
}

interface DotPosition {
  x: number;
  y: number;
  id: string;
  amount: number;
  name: string;
  studio: string;
}

export function useFlyingCards() {
  const [cards, setCards] = useState<FlyingCardData[]>([]);
  const [dots, setDots] = useState<DotPosition[]>([]);

  const addCard = useCallback((cardData: Omit<FlyingCardData, "id">) => {
    const id = Date.now().toString();
    setCards(prev => [...prev, { ...cardData, id }]);
  }, []);

  const removeCard = useCallback((id: string, dotPosition?: { x: number; y: number }, amount?: number, name?: string, studio?: string) => {
    setCards(prev => prev.filter(card => card.id !== id));
    
    // Add a dot at the specified position with amount for sizing and name/studio info
    if (dotPosition && amount && name && studio) {
      // Adjust position to keep dots away from center (assuming center is around viewport center)
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const minDistanceFromCenter = 80; // Minimum distance from center hashtag symbol
      
      let adjustedX = dotPosition.x;
      let adjustedY = dotPosition.y;
      
      // Calculate distance from center
      const distanceFromCenter = Math.sqrt(
        Math.pow(adjustedX - centerX, 2) + Math.pow(adjustedY - centerY, 2)
      );
      
      // If too close to center, push the dot away
      if (distanceFromCenter < minDistanceFromCenter) {
        const angle = Math.atan2(adjustedY - centerY, adjustedX - centerX);
        adjustedX = centerX + Math.cos(angle) * minDistanceFromCenter;
        adjustedY = centerY + Math.sin(angle) * minDistanceFromCenter;
      }
      
      setDots(prev => [...prev, { 
        x: adjustedX,
        y: adjustedY,
        id: `dot-${Date.now()}`, 
        amount,
        name,
        studio
      }]);
    }
  }, []);

  const FlyingCards = useCallback(() => (
    <>
      {cards.map(card => (
        <FlyingCard
          key={card.id}
          amount={card.amount}
          name={card.name}
          studio={card.studio}
          type={card.type}
          onComplete={(dotPosition) => removeCard(card.id, dotPosition, card.amount, card.name, card.studio)}
        />
      ))}
    </>
  ), [cards, removeCard]);

  const DonationDots = useCallback(() => (
    <>
      {dots.map(dot => {
        // Calculate dot size proportional to amount with better scaling
        // Size range: 8px (min) to 50px (max) based on amount
        const maxAmount = 5000; // Adjust this based on typical payment amounts
        const normalizedAmount = Math.min(dot.amount / maxAmount, 1);
        
        // Use logarithmic scaling for better visual distribution
        const logScale = Math.log(1 + normalizedAmount * 9) / Math.log(10);
        const size = Math.round(8 + logScale * 42); // 8px to 50px range
        
        return (
          <div
            key={dot.id}
            className="fixed pointer-events-none z-30 animate-scale-in"
            style={{
              left: dot.x - size/2, // Center the dot horizontally
              top: dot.y - size/2,  // Center the dot vertically
            }}
          >
            {/* The circle with glow effect for larger amounts */}
            <div
              className={`rounded-full donation-dot mb-1 transition-all duration-300 ${
                size > 25 ? 'shadow-lg shadow-pink-500/30' : ''
              }`}
              style={{
                width: `${size}px`,
                height: `${size}px`,
                backgroundColor: `hsl(${320 + (normalizedAmount * 40)}, 100%, ${50 + (normalizedAmount * 20)}%)`,
                margin: '0 auto',
                boxShadow: size > 25 ? `0 0 ${size/3}px rgba(255, 0, 127, 0.4)` : 'none'
              }}
            />
            
            {/* Name and Studio underneath - adjust text size based on dot size */}
            <div 
              className={`text-center text-white bg-black/70 rounded px-2 py-1 backdrop-blur-sm whitespace-nowrap ${
                size > 30 ? 'text-sm' : 'text-xs'
              }`}
              style={{
                fontSize: size > 30 ? '14px' : '12px'
              }}
            >
              <div className="font-semibold">{dot.name}</div>
              <div className="opacity-80" style={{fontSize: size > 30 ? '12px' : '10px'}}>
                {dot.studio} • ₹{dot.amount}
              </div>
            </div>
          </div>
        );
      })}
    </>
  ), [dots]);

  return {
    addCard,
    FlyingCards,
    DonationDots,
    dotsCount: dots.length
  };
}