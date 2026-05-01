package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	edgetts "github.com/bytectlgo/edge-tts/pkg/edge_tts"
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

const (
	defaultTimeoutMs       int64 = 75000
	defaultItemConcurrency int   = 10
	minItemConcurrency     int   = 1
	maxItemConcurrency     int   = 200
	maxJobConcurrency      int   = 16
)

func emit(v any) {
	line, err := json.Marshal(v)
	if err != nil {
		fallback, _ := json.Marshal(map[string]any{
			"event":   "worker_emit_error",
			"success": false,
			"error":   fmt.Sprintf("emit serialization failed: %v", err),
		})
		line = fallback
	}
	_, _ = os.Stdout.Write(append(line, '\n'))
}

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

func makeTempMP3Path(targetPath string) string {
	base := filepath.Base(targetPath)
	dir := filepath.Dir(targetPath)
	name := strings.TrimSuffix(base, filepath.Ext(base))
	if name == "" {
		name = "edge_tts"
	}
	stamp := time.Now().UnixNano()
	return filepath.Join(dir, fmt.Sprintf("%s.tmp.%d.mp3", name, stamp))
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

func runNativeEdgeTTS(ctx context.Context, job edgeJob, item edgeItem, outputPath string) error {
	if trimVisible(item.Text) == "" {
		return errors.New("empty text")
	}
	if trimVisible(outputPath) == "" {
		return errors.New("missing output path")
	}
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		return fmt.Errorf("create output dir failed: %w", err)
	}

	communicate := edgetts.NewCommunicate(
		item.Text,
		defaultIfEmpty(job.Voice, "vi-VN-HoaiMyNeural"),
		edgetts.WithRate(defaultIfEmpty(job.Rate, "+0%")),
		edgetts.WithVolume(defaultIfEmpty(job.Volume, "+0%")),
	)

	err := communicate.Save(ctx, outputPath, "")
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			return err
		}
		return fmt.Errorf("native edge-tts failed: %w", err)
	}

	stat, err := os.Stat(outputPath)
	if err != nil {
		return fmt.Errorf("native edge-tts output missing: %w", err)
	}
	if stat.Size() <= 0 {
		return errors.New("native edge-tts output is empty")
	}
	return nil
}

func defaultIfEmpty(value string, fallback string) string {
	if trimVisible(value) == "" {
		return fallback
	}
	return value
}

func convertMP3ToWAV(ctx context.Context, ffmpegPath string, srcPath string, dstPath string) error {
	if err := os.MkdirAll(filepath.Dir(dstPath), 0o755); err != nil {
		return fmt.Errorf("create wav dir failed: %w", err)
	}
	args := []string{
		"-y",
		"-i", srcPath,
		"-ac", "1",
		"-ar", "24000",
		"-sample_fmt", "s16",
		dstPath,
	}
	command := exec.CommandContext(ctx, ffmpegPath, args...)
	output, err := command.CombinedOutput()
	if err != nil {
		msg := trimVisible(string(output))
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("ffmpeg failed: %s", msg)
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

	switch outFormat {
	case "mp3":
		err := runNativeEdgeTTS(ctx, job, item, item.OutputPath)
		if err != nil {
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
		tmpMP3 := makeTempMP3Path(item.OutputPath)
		defer func() {
			_ = os.Remove(tmpMP3)
		}()

		err := runNativeEdgeTTS(ctx, job, item, tmpMP3)
		if err != nil {
			res.errorText = err.Error()
			return res
		}
		err = convertMP3ToWAV(ctx, ffmpegCmd, tmpMP3, item.OutputPath)
		if err != nil {
			res.errorText = err.Error()
			return res
		}
		err = validateGeneratedAudioFile(ctx, ffmpegCmd, ffprobeCmd, item.OutputPath)
		if err != nil {
			res.errorText = err.Error()
			return res
		}
		res.success = true
		if wavMode == "auto" || wavMode == "direct" {
			res.conversionMode = "mp3_to_wav_fallback"
		} else {
			res.conversionMode = "mp3_to_wav"
		}
		return res
	default:
		res.errorText = "unsupported output format: " + outFormat
		return res
	}
}

func executeJob(
	payload workerPayload,
	job edgeJob,
	ffmpegCmd string,
	ffprobeCmd string,
	results []doneItem,
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
			if it.Index <= 0 {
				continue
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
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

func collectOrderedResults(resultMap []doneItem) []doneItem {
	out := make([]doneItem, 0, len(resultMap))
	for _, item := range resultMap {
		if item.Index <= 0 {
			continue
		}
		out = append(out, item)
	}
	return out
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

	maxIndex := 0
	for _, job := range payload.Jobs {
		for _, item := range job.Items {
			if item.Index > maxIndex {
				maxIndex = item.Index
			}
		}
	}
	if maxIndex == 0 {
		emit(doneEvent{Event: "done", Results: []doneItem{}})
		return
	}

	resultsMap := make([]doneItem, maxIndex+1)
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

	emit(doneEvent{Event: "done", Results: collectOrderedResults(resultsMap)})
}
