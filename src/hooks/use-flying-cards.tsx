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

  const loadExistingTransactions = useCallback((transactions: any[]) => {
    const existingDots = transactions.map(transaction => {
      const walletData = transaction.wallets as any;
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const minDistanceFromCenter = 25;
      
      // Generate random position around center
      let x = centerX + (Math.random() - 0.5) * 400;
      let y = centerY + (Math.random() - 0.5) * 200;
      
      // Ensure minimum distance from center
      const distanceFromCenter = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
      if (distanceFromCenter < minDistanceFromCenter) {
        const angle = Math.atan2(y - centerY, x - centerX);
        x = centerX + Math.cos(angle) * minDistanceFromCenter;
        y = centerY + Math.sin(angle) * minDistanceFromCenter;
      }
      
      return {
        x,
        y,
        id: `existing-${transaction.id}`,
        amount: Number(transaction.amount),
        name: walletData?.attendee_name || 'Anonymous',
        studio: walletData?.studio || 'Unknown'
      };
    });
    
    setDots(existingDots);
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

  const DonationDots = useCallback(({ showLabels = true }: { showLabels?: boolean } = {}) => {
    return (
      <>
        {dots.map(dot => {
          // Use absolute value of amount for dot sizing
          const amount = Math.abs(dot.amount);
          
          // Calculate dot size proportional to amount with better scaling
          // Size range: 5px (min) to 32px (max) based on amount (20% smaller than previous)
          const maxAmount = 5000; // Adjust this based on typical payment amounts
          const normalizedAmount = Math.min(amount / maxAmount, 1);
          
          // Use logarithmic scaling for better visual distribution
          const logScale = Math.log(1 + normalizedAmount * 9) / Math.log(10);
          const size = Math.round(5 + logScale * 27); // 5px to 32px range (20% smaller)
          
          return (
            <div
              key={dot.id}
              className="fixed pointer-events-none z-50 animate-scale-in"
              style={{
                left: dot.x - size/2, // Center the dot horizontally
                top: dot.y - size/2,  // Center the dot vertically
              }}
            >
              {/* Simple pink circle - ensure it's a perfect circle */}
              <div
                className="mb-1 transition-all duration-300"
                style={{
                  width: `${size}px`,
                  height: `${size}px`,
                  backgroundColor: '#ff007f',
                  borderRadius: '50%',
                  border: 'none',
                  outline: 'none',
                  margin: '0 auto',
                  display: 'block'
                }}
              />
              
              {/* Name and Studio underneath - conditionally shown */}
              {showLabels && (
                <div className="text-center text-xs text-white bg-black/70 rounded px-2 py-1 backdrop-blur-sm whitespace-nowrap">
                  <div className="font-semibold">{dot.name}</div>
                  <div className="text-xs opacity-80">{dot.studio}</div>
                </div>
              )}
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
    dotsCount: dots.length,
    loadExistingTransactions
  };
}