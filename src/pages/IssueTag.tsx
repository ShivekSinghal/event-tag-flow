import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { nfcManager } from "@/utils/nfc";
import { supabase } from "@/integrations/supabase/client";
import { 
  NfcIcon as Nfc, 
  Scan, 
  CheckCircle, 
  AlertCircle,
  User,
  Phone,
  Tag,
  Building
} from "lucide-react";

export default function IssueTag() {
  const { toast } = useToast();
  const [isScanning, setIsScanning] = useState(false);
  const [scannedTag, setScannedTag] = useState<string | null>(null);
  const [attendeeName, setAttendeeName] = useState("");
  const [attendeePhone, setAttendeePhone] = useState("");
  const [selectedStudio, setSelectedStudio] = useState<string>("");
  const [nfcSupported, setNfcSupported] = useState<boolean | null>(null);

  // Check NFC support on component mount
  useEffect(() => {
    const checkNFCSupport = async () => {
      try {
        const supported = await nfcManager.isNFCSupported();
        setNfcSupported(supported);
        
        if (!supported) {
          toast({
            title: "NFC Not Supported",
            description: "This device/browser doesn't support NFC scanning.",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.warn('Error checking NFC support:', error);
        setNfcSupported(false);
      }
    };
    
    checkNFCSupport();
  }, [toast]);

  const handleScanNFC = async () => {
    // Check NFC support first
    if (nfcSupported === false) {
      toast({
        title: "NFC Not Supported",
        description: "This device/browser doesn't support NFC scanning.",
        variant: "destructive",
      });
      return;
    }

    // Check NFC permission
    const hasPermission = await nfcManager.checkNFCPermission();
    if (!hasPermission) {
      toast({
        title: "NFC Permission Required",
        description: "Please enable NFC in your device settings and browser permissions.",
        variant: "destructive",
      });
      return;
    }

    setIsScanning(true);
    
    try {
      console.log('Starting NFC scan...');
      const result = await nfcManager.startScanning();
      
      if (result.success) {
        setScannedTag(result.tagId);
        toast({
          title: "NFC Tag Scanned",
          description: `Successfully scanned tag: ${result.tagId}`,
        });
      } else {
        toast({
          title: "Scanning Failed",
          description: result.error || "Could not scan NFC tag. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('NFC scan error:', error);
      toast({
        title: "Scanning Failed",
        description: "Could not scan NFC tag. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsScanning(false);
    }
  };

  const handleIssueWallet = async () => {
    if (!scannedTag || !attendeeName || !attendeePhone || !selectedStudio) {
      toast({
        title: "Missing Information",
        description: "Please scan a tag and fill in all attendee details including studio.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Check if tag already exists
      const { data: existingWallet } = await supabase
        .from('wallets')
        .select('id')
        .eq('tag_id', scannedTag)
        .single();

      if (existingWallet) {
        toast({
          title: "Tag Already Used",
          description: "This NFC tag is already linked to a wallet.",
          variant: "destructive",
        });
        return;
      }

      // Create wallet in Supabase
      const { data, error } = await supabase
        .from('wallets')
        .insert({
          tag_id: scannedTag,
          attendee_name: attendeeName,
          attendee_phone: attendeePhone,
          studio: selectedStudio,
          balance: 0.00,
          status: 'active'
        })
        .select()
        .single();

      if (error) {
        throw error;
      }
      
      toast({
        title: "Wallet Created Successfully",
        description: `Digital wallet created for ${attendeeName} with tag ${scannedTag}`,
      });

      // Reset form
      setScannedTag(null);
      setAttendeeName("");
      setAttendeePhone("");
      setSelectedStudio("");
      
      // Stop any ongoing NFC scanning
      nfcManager.stopScanning();
    } catch (error) {
      toast({
        title: "Failed to Create Wallet",
        description: "There was an error creating the wallet. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-foreground">Issue NFC Tag</h1>
        <p className="text-muted-foreground mt-2">Scan an NFC tag and create a new digital wallet</p>
      </div>

      {/* NFC Scanning Card */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Nfc className="w-5 h-5 text-primary" />
            <span>NFC Tag Scanner</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Scan Button */}
          <div className="text-center">
            <Button
              onClick={handleScanNFC}
              disabled={isScanning || nfcSupported === false}
              size="lg"
              className="w-full max-w-xs bg-gradient-primary hover:shadow-hover transition-smooth"
            >
              {isScanning ? (
                <div className="flex items-center space-x-2">
                  <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                  <span>Scanning...</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <Scan className="w-5 h-5" />
                  <span>Scan NFC Tag</span>
                </div>
              )}
            </Button>
          </div>

          {/* Scanned Tag Display */}
          {scannedTag && (
            <div className="bg-success/10 border border-success/20 rounded-lg p-4 flex items-center space-x-3">
              <CheckCircle className="w-6 h-6 text-success" />
              <div>
                <div className="font-medium text-foreground">Tag Scanned Successfully</div>
                <div className="text-sm text-muted-foreground">
                  Tag ID: <Badge variant="outline" className="ml-1">{scannedTag}</Badge>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Attendee Information Card */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <User className="w-5 h-5 text-primary" />
            <span>Attendee Information</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="flex items-center space-x-2">
              <User className="w-4 h-4" />
              <span>Full Name</span>
            </Label>
            <Input
              id="name"
              placeholder="Enter attendee's full name"
              value={attendeeName}
              onChange={(e) => setAttendeeName(e.target.value)}
              className="transition-smooth focus:shadow-hover"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone" className="flex items-center space-x-2">
              <Phone className="w-4 h-4" />
              <span>Phone Number</span>
            </Label>
            <Input
              id="phone"
              placeholder="Enter phone number"
              value={attendeePhone}
              onChange={(e) => setAttendeePhone(e.target.value)}
              className="transition-smooth focus:shadow-hover"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="studio" className="flex items-center space-x-2">
              <Building className="w-4 h-4" />
              <span>Studio</span>
            </Label>
            <Select value={selectedStudio} onValueChange={setSelectedStudio}>
              <SelectTrigger className="transition-smooth focus:shadow-hover">
                <SelectValue placeholder="Select studio" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NDA">NDA</SelectItem>
                <SelectItem value="RG">RG</SelectItem>
                <SelectItem value="ED">ED</SelectItem>
                <SelectItem value="PP">PP</SelectItem>
                <SelectItem value="SD">SD</SelectItem>
                <SelectItem value="GGN">GGN</SelectItem>
                <SelectItem value="IPM">IPM</SelectItem>
                <SelectItem value="RMG">RMG</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Issue Wallet Button */}
      <div className="text-center">
        <Button
          onClick={handleIssueWallet}
          disabled={!scannedTag || !attendeeName || !attendeePhone || !selectedStudio}
          size="lg"
          className="w-full max-w-xs bg-gradient-primary hover:shadow-hover transition-smooth"
        >
          <div className="flex items-center space-x-2">
            <Tag className="w-5 h-5" />
            <span>Create Digital Wallet</span>
          </div>
        </Button>
      </div>

      {/* Info Card */}
      <Card className="shadow-card bg-muted/50">
        <CardContent className="pt-6">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-primary mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-2">Real Phone NFC Support:</p>
              <ul className="space-y-1">
                <li>• Works with Chrome browser on Android devices</li>
                <li>• Automatically detects and uses WebNFC API when available</li>
                <li>• Falls back to simulation mode on unsupported devices</li>
                <li>• Supports NTAG213/215/216 compatible NFC tags</li>
                <li>• Requires NFC to be enabled in device settings</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}