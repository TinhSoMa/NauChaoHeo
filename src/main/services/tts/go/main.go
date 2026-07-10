package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	edgetts "github.com/bytectlgo/edge-tts/pkg/edge_tts"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type workerPayload struct {
	Jobs            []edgeJob `json:"jobs"`
	TimeoutMs       int64     `json:"timeoutMs"`
	WavMode         string    `json:"wavMode"`
	ItemConcurrency int       `json:"itemConcurrency"`
}

type edgeJob struct {
	ProxyID      string     `json:"proxyId"`
	ProxyURL     string     `json:"proxyUrl"`
	Items        []edgeItem `json:"items"`
	Voice        string     `json:"voice"`
	Rate         string     `json:"rate"`
	Volume       string     `json:"volume"`
	OutputFormat string     `json:"outputFormat"`
}

type edgeItem struct {
	Index      int    `json:"index"`
	Filename   string `json:"filename"`
	Text       string `json:"text"`
	OutputPath string `json:"outputPath"`
}

type progressEvent struct {
	Event          string `json:"event"`
	Index          int    `json:"index"`
	Filename       string `json:"filename,omitempty"`
	ProxyID        string `json:"proxyId,omitempty"`
	Success        bool   `json:"success"`
	Error          string `json:"error,omitempty"`
	ConversionMode string `json:"conversionMode,omitempty"`
}

type doneItem struct {
	Index          int    `json:"index"`
	Success        bool   `json:"success"`
	Error          string `json:"error,omitempty"`
	ConversionMode string `json:"conversionMode,omitempty"`
}

type doneEvent struct {
	Event   string     `json:"event"`
	Results []doneItem `json:"results"`
}

type itemResult struct {
	index          int
	success        bool
	errorText      string
	filename       string
	proxyID        string
	conversionMode string
}

type jobExecutionStats struct {
	order       int
	proxyID     string
	items       int
	success     int
	failed      int
	timeoutFail int
	elapsedMs   int64
}

var proxyEnvMu sync.Mutex

// globalTTSSem giới hạn tổng số kết nối Edge TTS đồng thời (giống Python asyncio.Semaphore(5))
var globalTTSSem = make(chan struct{}, 5)

const (
	defaultTimeoutMs       int64 = 75000
	defaultItemConcurrency int   = 4
	minItemConcurrency     int   = 1
	maxItemConcurrency     int   = 8
	maxJobConcurrency      int   = 16
	trustedClientToken           = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
	secMsGecVersion              = "1-143.0.3650.75"
	wavOutputFormat              = "riff-24khz-16bit-mono-pcm"
	clockSkewMaxRetries          = 1
)

// WebSocket headers for direct WAV connection
var wssHeaders = http.Header{
	"Pragma":          {"no-cache"},
	"Cache-Control":   {"no-cache"},
	"Origin":          {"chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold"},
	"Accept-Language": {"en-US,en;q=0.9"},
	"User-Agent":      {"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0"},
}

var (
	clockSkewMu      sync.RWMutex
	clockSkewSeconds float64
)

func emit(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		data, _ = json.Marshal(map[string]any{
			"event":   "worker_emit_error",
			"success": false,
			"error":   fmt.Sprintf("emit serialization failed: %v", err),
		})
	}
	// Escape non-ASCII to \uXXXX (giống Python ensure_ascii=True)
	var buf bytes.Buffer
	for _, r := range string(data) {
		if r > 127 {
			_, _ = fmt.Fprintf(&buf, "\\u%04x", r)
		} else {
			buf.WriteRune(r)
		}
	}
	buf.WriteByte('\n')
	_, _ = os.Stdout.Write(buf.Bytes())
}

// --- Utility functions ---

var (
	reLetterDigit = regexp.MustCompile(`\p{L}|\p{N}`)
)

func sanitizeText(s string) string {
	var buf bytes.Buffer
	for _, r := range s {
		if r >= 0xD800 && r <= 0xDFFF {
			continue
		}
		buf.WriteRune(r)
	}
	return buf.String()
}

func hasAnyLetterOrDigit(s string) bool {
	return reLetterDigit.MatchString(s)
}

func looksLikeMP3Bytes(data []byte) bool {
	if len(data) < 2 {
		return false
	}
	if len(data) >= 3 && data[0] == 'I' && data[1] == 'D' && data[2] == '3' {
		return true
	}
	return data[0] == 0xFF && (data[1]&0xE0) == 0xE0
}

func looksLikeMP3(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	head := make([]byte, 3)
	if _, err := io.ReadFull(f, head); err != nil {
		return false
	}
	return looksLikeMP3Bytes(head)
}

func looksLikeWav(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	head := make([]byte, 12)
	if _, err := io.ReadFull(f, head); err != nil {
		return false
	}
	return bytes.Equal(head[:4], []byte("RIFF")) && bytes.Equal(head[8:12], []byte("WAVE"))
}

func generateSilentAudio(ctx context.Context, ffmpegPath, outputPath, format string) error {
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		return fmt.Errorf("create output dir: %w", err)
	}
	args := []string{
		"-y", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
		"-t", "1",
	}
	if format == "mp3" {
		args = append(args, "-c:a", "libmp3lame", "-b:a", "128k", outputPath)
	} else {
		args = append(args, "-c:a", "pcm_s16le", "-ar", "44100", "-ac", "1", outputPath)
	}
	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		detail := trimVisible(string(out))
		if detail == "" {
			detail = err.Error()
		}
		return fmt.Errorf("ffmpeg silent audio failed: %s", detail)
	}
	stat, err := os.Stat(outputPath)
	if err != nil {
		return fmt.Errorf("silent audio output missing: %w", err)
	}
	if stat.Size() <= 0 {
		return errors.New("silent audio output is empty")
	}
	return nil
}

// --- End Utility functions ---

// --- Direct WAV helpers ---

func getUnixTimestamp() int64 {
	clockSkewMu.RLock()
	skew := clockSkewSeconds
	clockSkewMu.RUnlock()
	return time.Now().Unix() + int64(skew)
}

func adjustClockSkew(date string) {
	t, err := time.Parse(time.RFC1123, date)
	if err != nil {
		return
	}
	clockSkewMu.Lock()
	clockSkewSeconds = t.Sub(time.Now().UTC()).Seconds()
	clockSkewMu.Unlock()
}

func generateSecMsGec() string {
	ticks := (getUnixTimestamp() + 11644473600) * 10000000
	ticks = ticks - (ticks % (300 * 10000000))
	hash := sha256.Sum256([]byte(fmt.Sprintf("%d%s", ticks, trustedClientToken)))
	return strings.ToUpper(hex.EncodeToString(hash[:]))
}

func dateToString() string {
	return time.Now().UTC().Format("Mon Jan 02 2006 15:04:05") + " GMT+0000 (Coordinated Universal Time)"
}

func headersWithMUID() http.Header {
	h := http.Header{}
	for k, v := range wssHeaders {
		h[k] = v
	}
	muid := make([]byte, 16)
	_, _ = rand.Read(muid)
	muidStr := strings.ToUpper(hex.EncodeToString(muid))
	h.Set("Cookie", "muid="+muidStr)
	return h
}

func getHeadersAndData(data []byte, headerLen int) (map[string]string, []byte) {
	headers := make(map[string]string)
	if len(data) < 2 || headerLen < 2 {
		return headers, nil
	}
	if headerLen > len(data) {
		return headers, nil
	}
	for _, line := range bytes.Split(data[2:2+headerLen], []byte("\r\n")) {
		if len(line) == 0 {
			continue
		}
		parts := bytes.SplitN(line, []byte(":"), 2)
		if len(parts) == 2 {
			headers[string(bytes.TrimSpace(parts[0]))] = string(bytes.TrimSpace(parts[1]))
		}
	}
	if len(data) <= headerLen+2 {
		return headers, nil
	}
	return headers, data[headerLen+2:]
}

func escapeXML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	s = strings.ReplaceAll(s, "'", "&apos;")
	return s
}

func buildSSML(text, voice, rate, volume string) string {
	return fmt.Sprintf(
		"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>"+
			"<voice name='%s'><prosody pitch='+0Hz' rate='%s' volume='%s'>%s</prosody></voice></speak>",
		voice, rate, volume, escapeXML(text),
	)
}

func synthesizeWavDirect(ctx context.Context, text, voice, rate, volume, outputPath string) error {
	if err := os.MkdirAll(filepath.Dir(outputPath), 0755); err != nil {
		return fmt.Errorf("create output dir: %w", err)
	}

	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
		TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
		},
		EnableCompression: true,
	}

	var conn *websocket.Conn
	var err error
	for attempt := 0; attempt <= clockSkewMaxRetries; attempt++ {
		connID := uuid.New().String()
		secGec := generateSecMsGec()
		wsURL := fmt.Sprintf(
			"wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=%s&ConnectionId=%s&Sec-MS-GEC=%s&Sec-MS-GEC-Version=%s",
			trustedClientToken, connID, secGec, secMsGecVersion,
		)

		var resp *http.Response
		conn, resp, err = dialer.DialContext(ctx, wsURL, headersWithMUID())
		if err == nil {
			break
		}
		if resp != nil {
			if date := resp.Header.Get("Date"); date != "" {
				adjustClockSkew(date)
			}
		}
		if attempt < clockSkewMaxRetries {
			select {
			case <-time.After(100 * time.Millisecond):
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}
	if err != nil {
		return fmt.Errorf("ws dial: %w", err)
	}
	defer func() {
		if conn != nil {
			conn.Close()
		}
	}()

	// Send speech.config
	configPayload := fmt.Sprintf(
		"X-Timestamp:%s\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n"+
			`{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"%s"}}}}`+"\r\n",
		dateToString(), wavOutputFormat,
	)
	if err := conn.WriteMessage(websocket.TextMessage, []byte(configPayload)); err != nil {
		return fmt.Errorf("send config: %w", err)
	}

	// Send SSML
	ssml := fmt.Sprintf(
		"X-RequestId:%s\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:%sZ\r\nPath:ssml\r\n\r\n%s",
		uuid.New().String(), dateToString(), buildSSML(text, voice, rate, volume),
	)
	if err := conn.WriteMessage(websocket.TextMessage, []byte(ssml)); err != nil {
		return fmt.Errorf("send ssml: %w", err)
	}

	// Read responses
	var audioParts [][]byte
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		msgType, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure) {
				break
			}
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				continue
			}
			return fmt.Errorf("read: %w", err)
		}

		if msgType == websocket.BinaryMessage {
			if len(message) < 2 {
				continue
			}
			headerLen := int(binary.BigEndian.Uint16(message[:2]))
			if headerLen > len(message) {
				continue
			}
			headers, data := getHeadersAndData(message, headerLen)
			if path, ok := headers["Path"]; ok && path == "audio" {
				if len(data) > 0 {
					audioParts = append(audioParts, data)
				}
			}
			continue
		}

		if msgType == websocket.TextMessage {
			if bytes.Contains(message, []byte("Path:turn.end")) {
				break
			}
		}
	}

	if len(audioParts) == 0 {
		return fmt.Errorf("no audio data received")
	}

	merged := bytes.Join(audioParts, nil)
	if err := os.WriteFile(outputPath, merged, 0644); err != nil {
		return fmt.Errorf("write output: %w", err)
	}

	return nil
}

// --- End Direct WAV helpers ---

// --- In-memory MP3 stream & pipe ---

func streamMP3Bytes(ctx context.Context, safeText, voice, rate, volume string) ([]byte, error) {
	communicate := edgetts.NewCommunicate(
		safeText,
		defaultIfEmpty(voice, "vi-VN-HoaiMyNeural"),
		edgetts.WithRate(defaultIfEmpty(rate, "+0%")),
		edgetts.WithVolume(defaultIfEmpty(volume, "+0%")),
	)
	ch, err := communicate.Stream(ctx)
	if err != nil {
		return nil, fmt.Errorf("edge-tts stream: %w", err)
	}

	var buf bytes.Buffer
	for chunk := range ch {
		switch chunk.Type {
		case "audio":
			buf.Write(chunk.Data)
		case "error":
			return nil, errors.New(string(chunk.Data))
		}
	}
	if buf.Len() == 0 {
		return nil, errors.New("empty mp3 audio stream")
	}
	return buf.Bytes(), nil
}

func pipeMP3ToWAV(ctx context.Context, ffmpegPath string, mp3Data []byte, dstPath string) error {
	if err := os.MkdirAll(filepath.Dir(dstPath), 0o755); err != nil {
		return fmt.Errorf("create wav dir: %w", err)
	}
	args := []string{
		"-y",
		"-f", "mp3",
		"-i", "pipe:0",
		"-ac", "1",
		dstPath,
	}
	cmd := exec.CommandContext(ctx, ffmpegPath, args...)
	cmd.Stdin = bytes.NewReader(mp3Data)
	output, err := cmd.CombinedOutput()
	if err != nil {
		msg := trimVisible(string(output))
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("ffmpeg pipe mp3->wav failed: %s", msg)
	}
	stat, err := os.Stat(dstPath)
	if err != nil {
		return fmt.Errorf("wav output missing: %w", err)
	}
	if stat.Size() <= 0 {
		return errors.New("wav output is empty")
	}
	return nil
}

// --- End In-memory MP3 stream & pipe ---

func normalizeWavMode(v string) string {
	lower := strings.ToLower(strings.TrimSpace(v))
	if lower == "direct" || lower == "convert" || lower == "auto" {
		return lower
	}
	return "auto"
}

func normalizeItemConcurrency(v int) int {
	if v < minItemConcurrency {
		return defaultItemConcurrency
	}
	if v > maxItemConcurrency {
		return maxItemConcurrency
	}
	return v
}

func normalizeTimeoutMs(v int64) int64 {
	if v <= 0 {
		return defaultTimeoutMs
	}
	return v
}

func normalizeJobConcurrency(totalJobs int, itemConcurrency int) int {
	if totalJobs <= 0 {
		return 1
	}
	// Keep bounded global pressure: total parallel items ~= jobConcurrency * itemConcurrency.
	jobConcurrency := itemConcurrency * 2
	if jobConcurrency < 2 {
		jobConcurrency = 2
	}
	if jobConcurrency > maxJobConcurrency {
		jobConcurrency = maxJobConcurrency
	}
	if jobConcurrency > totalJobs {
		jobConcurrency = totalJobs
	}
	return jobConcurrency
}

func hasProxyJobs(jobs []edgeJob) bool {
	for _, job := range jobs {
		if trimVisible(job.ProxyURL) != "" {
			return true
		}
	}
	return false
}

func trimVisible(s string) string {
	out := strings.TrimSpace(s)
	if out == "" {
		return ""
	}
	return out
}

func ffmpegCandidates() []string {
	result := make([]string, 0, 8)
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		result = append(result, p)
	}
	if runtime.GOOS == "windows" {
		if p, err := exec.LookPath("ffmpeg.exe"); err == nil {
			result = append(result, p)
		}
	}
	exe, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exe)
		result = append(result,
			filepath.Join(dir, "..", "..", "ffmpeg", "win64", "ffmpeg.exe"),
			filepath.Join(dir, "..", "ffmpeg", "win64", "ffmpeg.exe"),
			filepath.Join(dir, "ffmpeg", "win64", "ffmpeg.exe"),
		)
	}
	return result
}

func findFFmpegCommand() (string, error) {
	for _, c := range ffmpegCandidates() {
		if c == "" {
			continue
		}
		clean := filepath.Clean(c)
		if _, err := os.Stat(clean); err == nil {
			return clean, nil
		}
	}
	return "", errors.New("ffmpeg not found in PATH/resources")
}

func ffprobeCandidates(ffmpegPath string) []string {
	result := make([]string, 0, 10)
	if p, err := exec.LookPath("ffprobe"); err == nil {
		result = append(result, p)
	}
	if runtime.GOOS == "windows" {
		if p, err := exec.LookPath("ffprobe.exe"); err == nil {
			result = append(result, p)
		}
	}
	if trimVisible(ffmpegPath) != "" {
		dir := filepath.Dir(ffmpegPath)
		result = append(result, filepath.Join(dir, "ffprobe"))
		if runtime.GOOS == "windows" {
			result = append(result, filepath.Join(dir, "ffprobe.exe"))
		}
	}
	return result
}

func findFFprobeCommand(ffmpegPath string) string {
	for _, c := range ffprobeCandidates(ffmpegPath) {
		if c == "" {
			continue
		}
		clean := filepath.Clean(c)
		if _, err := os.Stat(clean); err == nil {
			return clean
		}
	}
	return ""
}

func withProxyEnv(proxyURL string, fn func() error) error {
	proxyURL = trimVisible(proxyURL)
	if proxyURL == "" {
		return fn()
	}

	proxyEnvMu.Lock()
	defer proxyEnvMu.Unlock()

	oldHTTP := os.Getenv("HTTP_PROXY")
	oldHTTPS := os.Getenv("HTTPS_PROXY")
	oldALL := os.Getenv("ALL_PROXY")

	_ = os.Setenv("HTTP_PROXY", proxyURL)
	_ = os.Setenv("HTTPS_PROXY", proxyURL)
	_ = os.Setenv("ALL_PROXY", proxyURL)
	defer func() {
		_ = os.Setenv("HTTP_PROXY", oldHTTP)
		_ = os.Setenv("HTTPS_PROXY", oldHTTPS)
		_ = os.Setenv("ALL_PROXY", oldALL)
	}()

	return fn()
}

func defaultIfEmpty(value string, fallback string) string {
	if trimVisible(value) == "" {
		return fallback
	}
	return value
}

func probeAudioDurationMs(ctx context.Context, ffprobePath string, audioPath string) (int64, error) {
	if trimVisible(ffprobePath) == "" {
		return 0, errors.New("ffprobe unavailable")
	}
	args := []string{
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		audioPath,
	}
	command := exec.CommandContext(ctx, ffprobePath, args...)
	output, err := command.CombinedOutput()
	if err != nil {
		msg := trimVisible(string(output))
		if msg == "" {
			msg = err.Error()
		}
		return 0, fmt.Errorf("ffprobe failed: %s", msg)
	}
	raw := trimVisible(string(output))
	if raw == "" {
		return 0, errors.New("ffprobe duration is empty")
	}
	durationSec, err := strconv.ParseFloat(strings.Fields(raw)[0], 64)
	if err != nil {
		return 0, fmt.Errorf("ffprobe duration parse failed: %w", err)
	}
	if durationSec <= 0 {
		return 0, errors.New("audio duration is 0s")
	}
	return int64(durationSec*1000 + 0.5), nil
}

func validateGeneratedAudioFile(
	ctx context.Context,
	ffmpegCmd string,
	ffprobeCmd string,
	filePath string,
) error {
	stat, err := os.Stat(filePath)
	if err != nil {
		return fmt.Errorf("output missing: %w", err)
	}
	if stat.Size() <= 0 {
		return errors.New("output is empty")
	}

	// Decode pass with ffmpeg to ensure container/frames are actually readable.
	decode := exec.CommandContext(ctx, ffmpegCmd, "-v", "error", "-i", filePath, "-f", "null", "-")
	decodeOutput, decodeErr := decode.CombinedOutput()
	if decodeErr != nil {
		msg := trimVisible(string(decodeOutput))
		if msg == "" {
			msg = decodeErr.Error()
		}
		return fmt.Errorf("decode validation failed: %s", msg)
	}

	if trimVisible(ffprobeCmd) != "" {
		durationMs, probeErr := probeAudioDurationMs(ctx, ffprobeCmd, filePath)
		if probeErr != nil {
			return probeErr
		}
		if durationMs <= 0 {
			return errors.New("audio duration is 0ms")
		}
	}

	return nil
}

func processItem(
	ctx context.Context,
	ffmpegCmd string,
	ffprobeCmd string,
	wavMode string,
	job edgeJob,
	item edgeItem,
) itemResult {
	res := itemResult{index: item.Index, filename: item.Filename, proxyID: job.ProxyID}
	outFormat := strings.ToLower(trimVisible(job.OutputFormat))
	if outFormat == "" {
		outFormat = strings.ToLower(filepath.Ext(item.OutputPath))
		outFormat = strings.TrimPrefix(outFormat, ".")
	}
	if outFormat == "" {
		outFormat = "wav"
	}
	if outFormat != "mp3" && outFormat != "wav" {
		res.errorText = "unsupported output format: " + outFormat
		return res
	}

	safeText := sanitizeText(item.Text)
	if !hasAnyLetterOrDigit(safeText) {
		err := generateSilentAudio(ctx, ffmpegCmd, item.OutputPath, outFormat)
		if err != nil {
			res.errorText = err.Error()
			return res
		}
		res.success = true
		res.conversionMode = "silent"
		return res
	}

	switch outFormat {
	case "mp3":
		mp3Data, err := streamMP3Bytes(ctx, safeText, job.Voice, job.Rate, job.Volume)
		if err != nil {
			res.errorText = err.Error()
			return res
		}
		if !looksLikeMP3Bytes(mp3Data) {
			res.errorText = "generated audio is not valid MP3 data"
			return res
		}
		if err := os.WriteFile(item.OutputPath, mp3Data, 0644); err != nil {
			res.errorText = err.Error()
			return res
		}
		err = validateGeneratedAudioFile(ctx, ffmpegCmd, ffprobeCmd, item.OutputPath)
		if err != nil {
			res.errorText = err.Error()
			return res
		}
		res.success = true
		res.conversionMode = "mp3_direct"
		return res
	case "wav":
		directTried := false
		if wavMode == "direct" || wavMode == "auto" {
			directTried = true
			err := synthesizeWavDirect(ctx, safeText, job.Voice, job.Rate, job.Volume, item.OutputPath)
			if err == nil {
				if !looksLikeWav(item.OutputPath) {
					err = errors.New("direct WAV output is not valid WAV data")
				}
			}
			if err == nil {
				err = validateGeneratedAudioFile(ctx, ffmpegCmd, ffprobeCmd, item.OutputPath)
			}
			if err == nil {
				res.success = true
				res.conversionMode = "direct_wav"
				return res
			}
			if wavMode == "direct" {
				res.errorText = fmt.Sprintf("direct wav failed: %v", err)
				return res
			}
			// wavMode == "auto": fall through to mp3→wav fallback
		}

		mp3Data, err := streamMP3Bytes(ctx, safeText, job.Voice, job.Rate, job.Volume)
		if err != nil {
			res.errorText = err.Error()
			return res
		}
		if !looksLikeMP3Bytes(mp3Data) {
			res.errorText = "generated stream is not valid MP3 data"
			return res
		}
		err = pipeMP3ToWAV(ctx, ffmpegCmd, mp3Data, item.OutputPath)
		if err != nil {
			res.errorText = err.Error()
			return res
		}
		if !looksLikeWav(item.OutputPath) {
			res.errorText = "converted audio is not valid WAV data"
			return res
		}
		err = validateGeneratedAudioFile(ctx, ffmpegCmd, ffprobeCmd, item.OutputPath)
		if err != nil {
			res.errorText = err.Error()
			return res
		}
		res.success = true
		if directTried {
			res.conversionMode = "mp3_to_wav_fallback"
		} else {
			res.conversionMode = "mp3_to_wav"
		}
		return res
	}
	return res
}

func executeJob(
	payload workerPayload,
	job edgeJob,
	ffmpegCmd string,
	ffprobeCmd string,
	results map[int]doneItem,
	resultMu *sync.Mutex,
) jobExecutionStats {
	startedAt := time.Now()
	stats := jobExecutionStats{
		proxyID: job.ProxyID,
		items:   len(job.Items),
	}

	run := func() {
		itemConcurrency := normalizeItemConcurrency(payload.ItemConcurrency)
		timeoutMs := normalizeTimeoutMs(payload.TimeoutMs)
		wavMode := normalizeWavMode(payload.WavMode)
		itemSem := make(chan struct{}, itemConcurrency)
		var wg sync.WaitGroup
		var statsMu sync.Mutex

		for _, item := range job.Items {
			it := item
			if it.Index < 0 {
				continue
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				globalTTSSem <- struct{}{}
				defer func() { <-globalTTSSem }()
				itemSem <- struct{}{}
				defer func() { <-itemSem }()

				ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
				defer cancel()

				res := processItem(ctx, ffmpegCmd, ffprobeCmd, wavMode, job, it)
				if errors.Is(ctx.Err(), context.DeadlineExceeded) && !res.success {
					res.errorText = "timeout exceeded"
				}

				statsMu.Lock()
				if res.success {
					stats.success++
				} else {
					stats.failed++
					if strings.Contains(strings.ToLower(res.errorText), "timeout") {
						stats.timeoutFail++
					}
				}
				statsMu.Unlock()

				evt := progressEvent{
					Event:          "progress",
					Index:          res.index,
					Filename:       res.filename,
					ProxyID:        res.proxyID,
					Success:        res.success,
					Error:          res.errorText,
					ConversionMode: res.conversionMode,
				}
				emit(evt)

				resultMu.Lock()
				results[res.index] = doneItem{
					Index:          res.index,
					Success:        res.success,
					Error:          res.errorText,
					ConversionMode: res.conversionMode,
				}
				resultMu.Unlock()
			}()
		}

		wg.Wait()
	}

	if trimVisible(job.ProxyURL) != "" {
		_ = withProxyEnv(job.ProxyURL, func() error {
			run()
			return nil
		})
	} else {
		run()
	}

	stats.elapsedMs = time.Since(startedAt).Milliseconds()
	return stats
}

func main() {
	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		emit(map[string]any{
			"event":   "done",
			"results": []doneItem{{Index: 0, Success: false, Error: fmt.Sprintf("stdin read failed: %v", err)}},
		})
		return
	}

	payload := workerPayload{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &payload); err != nil {
			emit(doneEvent{
				Event: "done",
				Results: []doneItem{{
					Index:   0,
					Success: false,
					Error:   fmt.Sprintf("invalid payload: %v", err),
				}},
			})
			return
		}
	}

	ffmpegCmd, err := findFFmpegCommand()
	if err != nil {
		emit(doneEvent{Event: "done", Results: []doneItem{{Index: 0, Success: false, Error: err.Error()}}})
		return
	}
	ffprobeCmd := findFFprobeCommand(ffmpegCmd)
	if trimVisible(ffprobeCmd) == "" {
		fmt.Fprintln(os.Stderr, "[GO_EDGE_WORKER] ffprobe not found, duration validation disabled")
	}

	totalItems := 0
	for _, job := range payload.Jobs {
		totalItems += len(job.Items)
	}
	if totalItems == 0 {
		emit(doneEvent{Event: "done", Results: []doneItem{}})
		return
	}

	resultsMap := make(map[int]doneItem)
	var resultMu sync.Mutex
	itemConcurrency := normalizeItemConcurrency(payload.ItemConcurrency)
	jobConcurrency := normalizeJobConcurrency(len(payload.Jobs), itemConcurrency)
	if hasProxyJobs(payload.Jobs) {
		jobConcurrency = 1
	}
	fmt.Fprintf(os.Stderr, "[GO_EDGE_WORKER] start jobs=%d itemConcurrency=%d jobConcurrency=%d timeoutMs=%d wavMode=%s\n",
		len(payload.Jobs), itemConcurrency, jobConcurrency, normalizeTimeoutMs(payload.TimeoutMs), normalizeWavMode(payload.WavMode))
	jobStats := make([]jobExecutionStats, len(payload.Jobs))
	var statsMu sync.Mutex
	workerStartedAt := time.Now()
	jobsSem := make(chan struct{}, jobConcurrency)
	var jobsWg sync.WaitGroup
	for i, job := range payload.Jobs {
		jobOrder := i
		j := job
		jobsWg.Add(1)
		go func() {
			defer jobsWg.Done()
			jobsSem <- struct{}{}
			defer func() { <-jobsSem }()
			stats := executeJob(payload, j, ffmpegCmd, ffprobeCmd, resultsMap, &resultMu)
			stats.order = jobOrder + 1
			statsMu.Lock()
			jobStats[jobOrder] = stats
			statsMu.Unlock()
		}()
	}
	jobsWg.Wait()

	workerElapsedMs := time.Since(workerStartedAt).Milliseconds()
	totalOK := 0
	totalFail := 0
	totalTimeout := 0
	for _, stat := range jobStats {
		totalOK += stat.success
		totalFail += stat.failed
		totalTimeout += stat.timeoutFail
		proxyLabel := stat.proxyID
		if strings.TrimSpace(proxyLabel) == "" {
			proxyLabel = "direct"
		}
		fmt.Fprintf(os.Stderr,
			"[GO_EDGE_WORKER] job#%d proxy=%s items=%d ok=%d fail=%d timeout=%d elapsedMs=%d\n",
			stat.order, proxyLabel, stat.items, stat.success, stat.failed, stat.timeoutFail, stat.elapsedMs)
	}
	fmt.Fprintf(os.Stderr,
		"[GO_EDGE_WORKER] done elapsedMs=%d totalOk=%d totalFail=%d timeoutFail=%d\n",
		workerElapsedMs, totalOK, totalFail, totalTimeout)

	ordered := make([]doneItem, 0, len(resultsMap))
	for _, item := range resultsMap {
		ordered = append(ordered, item)
	}
	emit(doneEvent{Event: "done", Results: ordered})
}
