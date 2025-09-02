-- Create games table to define available games/products
CREATE TABLE public.games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  studio TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create game_sales table to track sales count for each game
CREATE TABLE public.game_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES public.games(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  sale_price NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_sales ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for games (allow all operations for now)
CREATE POLICY "Allow all operations on games" 
ON public.games 
FOR ALL 
USING (true);

-- Create RLS policies for game_sales (allow all operations for now)
CREATE POLICY "Allow all operations on game_sales" 
ON public.game_sales 
FOR ALL 
USING (true);

-- Add game_id column to transactions table to link transactions to specific games
ALTER TABLE public.transactions 
ADD COLUMN game_id UUID REFERENCES public.games(id);

-- Create update trigger for games
CREATE TRIGGER update_games_updated_at
BEFORE UPDATE ON public.games
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert sample games for each studio
INSERT INTO public.games (name, description, price, studio) VALUES
('VR Racing Challenge', 'High-speed virtual reality racing experience', 150.00, 'NDA'),
('Escape Room Mystery', 'Immersive escape room adventure', 200.00, 'NDA'),
('Battle Arena Pro', 'Multiplayer combat simulation', 180.00, 'RG'),
('Dragon Quest VR', 'Fantasy adventure in virtual reality', 220.00, 'RG'),
('Dance Revolution', 'Interactive dance and rhythm game', 120.00, 'ED'),
('Music Maker Studio', 'Create and mix your own music', 160.00, 'ED'),
('Puzzle Master', 'Mind-bending puzzle challenges', 100.00, 'PP'),
('Strategy Warfare', 'Real-time strategy battle game', 190.00, 'PP'),
('Sports Champions', 'Virtual sports competition', 170.00, 'SD'),
('Fitness Challenge', 'Interactive fitness and workout game', 140.00, 'SD'),
('Adventure Quest', 'Epic story-driven adventure', 210.00, 'GGN'),
('Treasure Hunt VR', 'Explore and find hidden treasures', 180.00, 'GGN'),
('Flight Simulator', 'Realistic flight experience', 250.00, 'IPM'),
('Space Explorer', 'Journey through the cosmos', 230.00, 'IPM'),
('Car Racing Pro', 'Professional car racing simulation', 200.00, 'RMG'),
('Bike Stunts VR', 'Extreme bike stunts in virtual reality', 180.00, 'RMG');