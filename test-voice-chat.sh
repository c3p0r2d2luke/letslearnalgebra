#!/bin/bash

# Voice Chat Test Script
# This script helps test the voice chat functionality

echo "🔬 Voice Chat Test Script"
echo "========================"
echo ""

# Check if we're in the right directory
if [ ! -f "s/chat.html" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    echo "   (where s/chat.html exists)"
    exit 1
fi

echo "📍 Current directory: $(pwd)"
echo ""

# Check if required files exist
echo "📁 Checking required files..."
files=("s/chat.html" "s/script.js" "s/styles.css")
for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file exists"
    else
        echo "❌ $file missing"
    fi
done
echo ""

# Check for common voice chat issues in the code
echo "🔍 Checking for common voice chat issues..."

# Check for getUserMedia usage
if grep -q "getUserMedia" s/script.js; then
    echo "✅ getUserMedia found in script.js"
else
    echo "❌ getUserMedia not found in script.js"
fi

# Check for WebRTC support
if grep -q "RTCPeerConnection" s/script.js; then
    echo "✅ RTCPeerConnection found in script.js"
else
    echo "❌ RTCPeerConnection not found in script.js"
fi

# Check for audio context
if grep -q "AudioContext" s/script.js; then
    echo "✅ AudioContext found in script.js"
else
    echo "❌ AudioContext not found in script.js"
fi

# Check for voice channel handling
if grep -q "joinVoiceChannel" s/script.js; then
    echo "✅ joinVoiceChannel function found"
else
    echo "❌ joinVoiceChannel function not found"
fi

echo ""

# Instructions for manual testing
echo "🧪 Manual Testing Instructions:"
echo "=============================="
echo "1. Open chat.html in a browser:"
echo "   open s/chat.html"
echo "   or"
echo "   python3 -m http.server 8000 && open http://localhost:8000/s/chat.html"
echo ""
echo "2. Open browser developer console (F12)"
echo ""
echo "3. Run voice chat diagnostic tests:"
echo "   testVoiceChat()     - Comprehensive test"
echo "   quickVoiceCheck()   - Quick status check"
echo "   testAudioPlayback() - Test audio output"
echo ""
echo "4. Common issues to check:"
echo "   - Microphone permissions (must be granted)"
echo "   - Audio devices (must have input/output devices)"
echo "   - WebRTC support (browser compatibility)"
echo "   - Network connectivity (for peer connections)"
echo ""
echo "5. To test voice chat:"
echo "   - Create or join a voice channel"
echo "   - Check console for any errors"
echo "   - Verify microphone access is granted"
echo "   - Test with another user if possible"
echo ""

# Offer to start a local server
echo "🚀 Would you like to start a local server for testing?"
echo "   Run: python3 -m http.server 8000"
echo "   Then open: http://localhost:8000/s/chat.html"
echo ""

echo "✅ Voice chat test script completed!"
echo "   Follow the instructions above to test voice chat functionality."
