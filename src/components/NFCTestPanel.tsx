import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Smartphone, Wifi, AlertCircle, CheckCircle, Chrome } from 'lucide-react';
import { nfcManager } from '@/utils/nfc';

export const NFCTestPanel = () => {
  const [isScanning, setIsScanning] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [deviceInfo, setDeviceInfo] = useState<any>(null);

  useEffect(() => {
    // Collect device information
    const userAgent = navigator.userAgent.toLowerCase();
    const isAndroid = /android/.test(userAgent);
    const isChrome = /chrome/.test(userAgent) && !/edg/.test(userAgent);
    const hasNDEFReader = 'NDEFReader' in window;
    
    setDeviceInfo({
      userAgent: navigator.userAgent,
      isAndroid,
      isChrome,
      hasNDEFReader,
      platform: navigator.platform,
      language: navigator.language,
      cookieEnabled: navigator.cookieEnabled,
    });
  }, []);

  const handleTestScan = async () => {
    setIsScanning(true);
    setLastResult(null);
    
    try {
      console.log('Starting NFC test scan...');
      const result = await nfcManager.startScanning();
      console.log('NFC test scan result:', result);
      setLastResult(result);
    } catch (error) {
      console.error('NFC test scan error:', error);
      setLastResult({
        success: false,
        error: `Test scan failed: ${error}`,
        tagId: ''
      });
    } finally {
      setIsScanning(false);
    }
  };

  const resetTest = () => {
    nfcManager.forceReset();
    setLastResult(null);
    setIsScanning(false);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-5 w-5" />
          NFC Diagnostic Panel
        </CardTitle>
        <CardDescription>
          Test NFC functionality and check device compatibility
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Device Compatibility */}
        <div className="space-y-2">
          <h4 className="font-semibold">Device Compatibility</h4>
          {deviceInfo && (
            <div className="grid grid-cols-1 gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span>Android Device:</span>
                <Badge variant={deviceInfo.isAndroid ? "default" : "destructive"}>
                  {deviceInfo.isAndroid ? "Yes" : "No"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>Chrome Browser:</span>
                <Badge variant={deviceInfo.isChrome ? "default" : "destructive"}>
                  {deviceInfo.isChrome ? "Yes" : "No"}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span>NFC API Available:</span>
                <Badge variant={deviceInfo.hasNDEFReader ? "default" : "destructive"}>
                  {deviceInfo.hasNDEFReader ? "Yes" : "No"}
                </Badge>
              </div>
            </div>
          )}
        </div>

        {/* Requirements Alert */}
        {deviceInfo && (!deviceInfo.isAndroid || !deviceInfo.isChrome || !deviceInfo.hasNDEFReader) && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>NFC Requirements Not Met:</strong>
              <ul className="mt-1 list-disc list-inside space-y-1">
                {!deviceInfo.isAndroid && <li>Must use an Android device</li>}
                {!deviceInfo.isChrome && <li>Must use Chrome browser</li>}
                {!deviceInfo.hasNDEFReader && <li>NFC must be enabled in device settings</li>}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Test Controls */}
        <div className="flex gap-2">
          <Button 
            onClick={handleTestScan} 
            disabled={isScanning}
            className="flex items-center gap-2"
          >
            <Wifi className="h-4 w-4" />
            {isScanning ? 'Scanning...' : 'Test NFC Scan'}
          </Button>
          <Button variant="outline" onClick={resetTest}>
            Reset
          </Button>
        </div>

        {/* Scan Status */}
        {isScanning && (
          <Alert>
            <Wifi className="h-4 w-4" />
            <AlertDescription>
              NFC scanning active. Please place an NFC tag near your device.
            </AlertDescription>
          </Alert>
        )}

        {/* Last Result */}
        {lastResult && (
          <div className="space-y-2">
            <h4 className="font-semibold">Last Scan Result</h4>
            <Alert variant={lastResult.success ? "default" : "destructive"}>
              {lastResult.success ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <AlertDescription>
                {lastResult.success ? (
                  <div>
                    <strong>Success!</strong> Tag ID: {lastResult.tagId}
                  </div>
                ) : (
                  <div>
                    <strong>Failed:</strong> {lastResult.error}
                  </div>
                )}
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* Debug Info */}
        {deviceInfo && (
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold mb-2">Debug Information</summary>
            <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
              {JSON.stringify(deviceInfo, null, 2)}
            </pre>
          </details>
        )}

        {/* Instructions */}
        <Alert>
          <Chrome className="h-4 w-4" />
          <AlertDescription>
            <strong>Instructions:</strong>
            <ol className="mt-1 list-decimal list-inside space-y-1">
              <li>Ensure you're using Chrome on Android</li>
              <li>Enable NFC in Android Settings &gt; Connected devices &gt; Connection preferences</li>
              <li>Grant Chrome permission to access NFC when prompted</li>
              <li>Hold NFC tag close to the back of your phone</li>
            </ol>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
};