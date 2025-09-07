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
      // Adjust position to keep dots just away from center logo with minimal padding
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const minDistanceFromCenter = 25; // Just 1-2px padding from logo
      
      let adjustedX = dotPosition.x;
      let adjustedY = dotPosition.y;
      
      // Calculate distance from center
      const distanceFromCenter = Math.sqrt(
        Math.pow(adjustedX - centerX, 2) + Math.pow(adjustedY - centerY, 2)
      );
      
      // If too close to center, push the dot away minimally
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

  const DonationDots = useCallback(() => {
    console.log('DonationDots rendered, dots count:', dots.length);
    return (
      <>
        {dots.map(dot => {
          console.log('Rendering dot:', dot);
          // Calculate dot size proportional to amount with better scaling
          // Size range: 8px (min) to 50px (max) based on amount
          const maxAmount = 5000; // Adjust this based on typical payment amounts
          const normalizedAmount = Math.min(dot.amount / maxAmount, 1);
          
          // Use logarithmic scaling for better visual distribution
          const logScale = Math.log(1 + normalizedAmount * 9) / Math.log(10);
          const size = Math.round(8 + logScale * 42); // 8px to 50px range
          
          console.log('Dot size:', size, 'at position:', dot.x, dot.y);
          
          return (
            <div
              key={dot.id}
              className="fixed pointer-events-none z-50 animate-scale-in"
              style={{
                left: dot.x - size/2, // Center the dot horizontally
                top: dot.y - size/2,  // Center the dot vertically
              }}
            >
              {/* Simple pink circle with forced color */}
              <div
                className="rounded-full mb-1 transition-all duration-300"
                style={{
                  width: `${size}px`,
                  height: `${size}px`,
                  backgroundColor: '#ff007f !important',
                  background: '#ff007f',
                  border: '2px solid #ff007f',
                  margin: '0 auto'
                }}
              />
              
              {/* Name and Studio underneath - no amount */}
              <div className="text-center text-xs text-white bg-black/70 rounded px-2 py-1 backdrop-blur-sm whitespace-nowrap">
                <div className="font-semibold">{dot.name}</div>
                <div className="text-xs opacity-80">{dot.studio}</div>
              </div>
            </div>
          );
        })}
      </>
    );
  }, [dots]);

  return {
    addCard,
    FlyingCards,
    DonationDots,
    dotsCount: dots.length
  };
}