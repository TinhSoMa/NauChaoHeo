import tkinter as tk
from tkinter import ttk, filedialog, colorchooser, messagebox, simpledialog
import os
import threading
import logging
import cv2
import random
import json
import re
import subprocess
import tempfile
import numpy as np
from PIL import Image, ImageTk
from app.ui.components.file_combobox import FileCombobox
from app.core.caption_funtion import convert_srt_to_ass, get_sample_caption

DEFAULT_CAPTION_CONFIG = {
    "default_font": "Tiên Nữ",
    "default_size": 62,
    "default_color": "#FFFF00",
    "shadow": 4
}

class CaptionTab:
    """Tab Caption - Vùng Video & Hardsub (Video Region Selector)"""

    def __init__(self, parent, work_dir_var=None):
        self.parent = parent
        self.work_dir_var = work_dir_var
        self.frame = ttk.Frame(parent)
        
        # State variables
        self.is_running = False
        self.mode_var = tk.StringVar(value="region") # 'region' or 'caption'
        self.aspect_ratio_var = tk.StringVar(value="16:9") # '16:9' or '6:9'
        self.scale_ratio = 1.0
        self.video_dims = (1920, 1080) # Default placeholder
        self.placeholder_displayed = False
        
        # Core State variables
        self.current_frame = None
        self.frame_image = None
        self.canvas_image_id = None
        self.original_size = (0, 0)
        self.scaled_size = (0, 0)
        self.image_offset_x = 0
        self.image_offset_y = 0
        
        self.region_start = None
        self.region_end = None
        self.rect_id = None
        self.saved_coordinates = None
        
        self.caption_preview_id = None
        self.caption_drag_data = {"x": 0, "y": 0}
        self.current_caption_text = None  # Cache for current caption text
        
        self.video_file_map = {}
        self.srt_file_map = {}
        self.ass_file_map = {}
        
        # Default CapCut drafts path
        self.default_draft_folder = "D:/User/CongTinh/Videos/CapCut Drafts"
        
        # Load caption config from app_config.json
        self.load_caption_config()
        
        self.setup_ui()
        
        # Display initial placeholder
        self.frame.after(100, self.display_placeholder)

    def setup_ui(self):
        # Layout: Left Pane (Canvas) | Right Pane (Controls)
        paned = ttk.PanedWindow(self.frame, orient=tk.HORIZONTAL)
        paned.pack(fill=tk.BOTH, expand=True)

        # ================== LEFT PANE: PREVIEW ==================
        left_frame = ttk.Frame(paned, padding="5")
        paned.add(left_frame, weight=4)

        # 1. Canvas Toolbar
        f_toolbar = ttk.Frame(left_frame)
        f_toolbar.pack(fill='x', pady=2)
        
        ttk.Label(f_toolbar, text="Chế độ:").pack(side=tk.LEFT)
        ttk.Radiobutton(f_toolbar, text="Chọn Vùng", variable=self.mode_var, value="region", command=self._on_mode_change).pack(side=tk.LEFT, padx=5)
        ttk.Radiobutton(f_toolbar, text="Kéo Caption", variable=self.mode_var, value="caption", command=self._on_mode_change).pack(side=tk.LEFT, padx=5)
        
        ttk.Separator(f_toolbar, orient='vertical').pack(side=tk.LEFT, fill='y', padx=10)
        
        ttk.Label(f_toolbar, text="Tỷ lệ:").pack(side=tk.LEFT)
        ttk.Radiobutton(f_toolbar, text="16:9", variable=self.aspect_ratio_var, value="16:9", command=self._on_aspect_ratio_change).pack(side=tk.LEFT)
        ttk.Radiobutton(f_toolbar, text="6:9", variable=self.aspect_ratio_var, value="6:9", command=self._on_aspect_ratio_change).pack(side=tk.LEFT, padx=5)
        
        ttk.Button(f_toolbar, text="Frame Ngẫu nhiên", command=self.load_random_frame, width=18).pack(side=tk.LEFT, padx=5)
        
        ttk.Separator(f_toolbar, orient='vertical').pack(side=tk.LEFT, fill='y', padx=10)
        self.lbl_margin_v = ttk.Label(f_toolbar, text="Khoảng cách đáy (Margin-V): 0px", foreground="blue", font=("Arial", 9, "bold"))
        self.lbl_margin_v.pack(side=tk.LEFT)

        # 2. Canvas Container
        self.canvas_container = ttk.Frame(left_frame, borderwidth=2, relief="sunken")
        self.canvas_container.pack(fill=tk.BOTH, expand=True)
        
        # Canvas
        self.canvas = tk.Canvas(self.canvas_container, bg="#e0e0e0", cursor="tcross")
        self.canvas.pack(fill=tk.BOTH, expand=True)
        
        # Bind events for drawing/dragging
        self.canvas.bind("<ButtonPress-1>", self.on_mouse_down)
        self.canvas.bind("<B1-Motion>", self.on_mouse_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_mouse_up)
        # Bind resize event
        self.canvas.bind("<Configure>", self._on_canvas_resize)

        # 3. Canvas Status
        self.lbl_canvas_info = ttk.Label(left_frame, text="Sẵn sàng | Video: N/A", relief="sunken", anchor="w")
        self.lbl_canvas_info.pack(fill='x', pady=2)


        # ================== RIGHT PANE: CONTROLS ==================
        right_frame = ttk.Frame(paned, padding="10", width=400)
        paned.add(right_frame, weight=1)
        
        # --- Group 1: File Management (Auto-detect) ---
        grp_files = ttk.LabelFrame(right_frame, text="Quản lý File", padding="5")
        grp_files.pack(fill='x', pady=5)
        
        # Video File
        ttk.Label(grp_files, text="File Video:").pack(anchor='w')
        self.video_path_var = tk.StringVar()
        f_video = ttk.Frame(grp_files)
        f_video.pack(fill='x', pady=2)
        self.cb_video = FileCombobox(f_video, self.work_dir_var, ['.mp4', '.mov', '.mkv'], textvariable=self.video_path_var, width=25)
        self.cb_video.pack(side=tk.LEFT, fill='x', expand=True)
        ttk.Button(f_video, text="Duyệt...", width=8, command=self._browse_video).pack(side=tk.LEFT, padx=(5,0))
        
        # Random Frame Button (Moved to toolbar)

        # Subtitle File
        # SRT File
        ttk.Label(grp_files, text="File SRT:").pack(anchor='w')
        self.srt_path_var = tk.StringVar()
        f_srt = ttk.Frame(grp_files)
        f_srt.pack(fill='x', pady=2)
        self.cb_srt = FileCombobox(f_srt, self.work_dir_var, ['.srt'], textvariable=self.srt_path_var, width=25)
        self.cb_srt.pack(side=tk.LEFT, fill='x', expand=True)
        ttk.Button(f_srt, text="Duyệt...", width=8, command=self._browse_srt).pack(side=tk.LEFT, padx=5)
        ttk.Button(f_srt, text="ASS", width=8, command=self.run_convert_ass).pack(side=tk.LEFT, padx=(0, 5))

        # ASS File
        ttk.Label(grp_files, text="File ASS:").pack(anchor='w')
        self.ass_path_var = tk.StringVar()
        f_ass = ttk.Frame(grp_files)
        f_ass.pack(fill='x', pady=2)
        self.cb_ass = FileCombobox(f_ass, self.work_dir_var, ['.ass'], textvariable=self.ass_path_var, width=25)
        self.cb_ass.pack(side=tk.LEFT, fill='x', expand=True)
        ttk.Button(f_ass, text="Duyệt...", width=8, command=self._browse_ass).pack(side=tk.LEFT, padx=5)
        
        # Bind events immediately
        self.cb_video.bind('<<ComboboxSelected>>', self._on_video_selected)
        self.cb_srt.bind('<<ComboboxSelected>>', self._on_srt_selected)
        self.cb_ass.bind('<<ComboboxSelected>>', self._on_ass_selected)
        
        # --- Group 2: Region & Style ---
        grp_region = ttk.LabelFrame(right_frame, text="Vùng & Style", padding="5")
        grp_region.pack(fill='x', pady=5)
        
        # Coordinates
        f_coord = ttk.Frame(grp_region)
        f_coord.pack(fill='x', pady=2)
        self.var_x, self.var_y = tk.IntVar(), tk.IntVar()
        self.var_w, self.var_h = tk.IntVar(), tk.IntVar()
        
        ttk.Label(f_coord, text="X:").pack(side=tk.LEFT, padx=(0, 2))
        ttk.Entry(f_coord, textvariable=self.var_x, width=5).pack(side=tk.LEFT, padx=(0, 5))

        ttk.Label(f_coord, text="Y:").pack(side=tk.LEFT, padx=(0, 2))
        ttk.Entry(f_coord, textvariable=self.var_y, width=5).pack(side=tk.LEFT, padx=(0, 5))
        
        ttk.Label(f_coord, text="W:").pack(side=tk.LEFT, padx=(0, 2))
        ttk.Entry(f_coord, textvariable=self.var_w, width=5).pack(side=tk.LEFT, padx=(0, 5))
        
        ttk.Label(f_coord, text="H:").pack(side=tk.LEFT, padx=(0, 2))
        ttk.Entry(f_coord, textvariable=self.var_h, width=5).pack(side=tk.LEFT, padx=(0,10))
        
        # Reset button on same line
        ttk.Button(f_coord, text="Đặt lại Vùng", command=self.reset_region, width=12).pack(side=tk.LEFT)
        
        ttk.Separator(grp_region).pack(fill='x', pady=5)
        
        # Style Controls (Horizontal layout)
        f_style = ttk.Frame(grp_region)
        f_style.pack(fill='x', pady=(0,5))
        
        # Font
        ttk.Label(f_style, text="Font:").pack(side=tk.LEFT, padx=(0,2))
        self.font_var = tk.StringVar(value=getattr(self, 'default_font', "Arial"))
        ttk.Combobox(f_style, textvariable=self.font_var, values=["Tiên Nữ", "Arial", "Roboto", "Times New Roman", "Tahoma"], width=12).pack(side=tk.LEFT, padx=(0,10))
        
        # Size
        ttk.Label(f_style, text="Cỡ:").pack(side=tk.LEFT, padx=(0,2))
        self.size_var = tk.StringVar(value=str(getattr(self, 'default_size', 20)))
        ttk.Spinbox(f_style, from_=10, to=200, textvariable=self.size_var, width=5).pack(side=tk.LEFT, padx=(0,10))
        
        # Color
        self.btn_color = ttk.Button(f_style, text="Màu", width=6, command=self.pick_color)
        self.btn_color.pack(side=tk.LEFT)
        
        # Set default color
        self.selected_color = getattr(self, 'default_color', "#FFFFFF")
        
        # Bind style changes to update preview
        self.font_var.trace_add("write", lambda *args: self.update_caption_style())
        self.size_var.trace_add("write", lambda *args: self.update_caption_style())
        
        
        # Checkboxes (Removed per user request, Shadow always True)
        # f_checks = ttk.Frame(grp_region)
        # f_checks.pack(fill='x', pady=2)
        self.chk_bold = tk.BooleanVar(value=False)
        self.chk_shadow = tk.BooleanVar(value=True) # Always on
        # ttk.Checkbutton(f_checks, text="Đậm", variable=self.chk_bold).pack(side=tk.LEFT, padx=5)
        # ttk.Checkbutton(f_checks, text="Bóng", variable=self.chk_shadow).pack(side=tk.LEFT, padx=5)

        # --- Group 3: Render Video ---
        grp_render = ttk.LabelFrame(right_frame, text="Render Video", padding="5")
        grp_render.pack(fill='x', pady=5)
        
        # Create 2 column layout
        cols_frame = ttk.Frame(grp_render)
        cols_frame.pack(fill='x')
        
        # Left column: Parameters
        left_col = ttk.Frame(cols_frame)
        left_col.pack(side=tk.LEFT, fill='both', expand=True, padx=(0,5))
        
        # Width
        f_width = ttk.Frame(left_col)
        f_width.pack(fill='x', pady=(0,3))
        ttk.Label(f_width, text="Width:").pack(side=tk.LEFT, padx=(0,2))
        self.render_width_var = tk.StringVar(value="1920")
        ttk.Entry(f_width, textvariable=self.render_width_var, width=10).pack(side=tk.LEFT, fill='x', expand=True)
        
        # Height
        f_height = ttk.Frame(left_col)
        f_height.pack(fill='x', pady=(0,3))
        ttk.Label(f_height, text="Height:").pack(side=tk.LEFT, padx=(0,2))
        self.render_height_var = tk.StringVar(value="200")
        ttk.Entry(f_height, textvariable=self.render_height_var, width=10).pack(side=tk.LEFT, fill='x', expand=True)
        
        # Padding (extra time at end)
        f_dur = ttk.Frame(left_col)
        f_dur.pack(fill='x')
        ttk.Label(f_dur, text="Padding (s):").pack(side=tk.LEFT, padx=(0,2))
        self.render_padding_var = tk.StringVar(value="10")
        ttk.Entry(f_dur, textvariable=self.render_padding_var, width=10).pack(side=tk.LEFT, fill='x', expand=True)
        
        # Encoding method selector
        ttk.Separator(left_col, orient='horizontal').pack(fill='x', pady=(5,5))
        ttk.Label(left_col, text="Encoding:", font=("Arial", 8, "bold")).pack(anchor='w')
        
        self.encoding_method_var = tk.StringVar(value="gpu")  # Default: Intel GPU
        
        f_encoding = ttk.Frame(left_col)
        f_encoding.pack(fill='x', pady=(2,0))
        ttk.Radiobutton(f_encoding, text="Intel GPU", variable=self.encoding_method_var, value="gpu").pack(side=tk.LEFT, padx=(0,5))
        ttk.Radiobutton(f_encoding, text="CPU", variable=self.encoding_method_var, value="cpu").pack(side=tk.LEFT)
        
        # Right column: Action & Progress
        right_col = ttk.Frame(cols_frame)
        right_col.pack(side=tk.LEFT, fill='both', expand=True)
        
        # Render button
        ttk.Button(right_col, text="Render", command=self.render_video_from_ass).pack(fill='x', pady=(0,5))
        
        # Progress bar (determinate mode for actual percentage)
        self.render_progress = ttk.Progressbar(right_col, mode='determinate', maximum=100)
        self.render_progress.pack(fill='x', pady=(0,2))
        
        # Progress label
        self.render_progress_label = ttk.Label(right_col, text="", font=("Arial", 8))
        self.render_progress_label.pack(anchor='w')
        
        # Stop button
        self.render_stop_btn = ttk.Button(right_col, text="Dừng", command=self.stop_render, state='disabled')
        self.render_stop_btn.pack(fill='x', pady=(5,0))
        
        # Track render process
        self.render_process = None





    # --- Logic Implementation ---
    def load_caption_config(self):
        """Load caption configuration from app_config.json"""
        config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "app_config.json")
        
        # Set defaults from constant
        self.default_font = DEFAULT_CAPTION_CONFIG["default_font"]
        self.default_size = DEFAULT_CAPTION_CONFIG["default_size"]
        self.default_color = DEFAULT_CAPTION_CONFIG["default_color"]
        self.default_shadow = DEFAULT_CAPTION_CONFIG["shadow"]
        
        try:
            if os.path.exists(config_path):
                with open(config_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    caption_config = config.get('caption_config', {})
                    
                    self.default_font = caption_config.get('default_font', self.default_font)
                    self.default_size = caption_config.get('default_size', self.default_size)
                    self.default_color = caption_config.get('default_color', self.default_color)
                    self.default_shadow = caption_config.get('shadow', self.default_shadow)
                    
                    logging.info(f"Loaded caption config: font={self.default_font}, size={self.default_size}, color={self.default_color}, shadow={self.default_shadow}")
        except Exception as e:
            logging.error(f"Error loading caption config: {e}")

    
    def _get_work_dir(self):
        return self.work_dir_var.get() if self.work_dir_var else os.getcwd()

    def _browse_video(self):
        f = filedialog.askopenfilename(
            title="Chọn file Video",
            filetypes=[("Video files", "*.mp4 *.mov *.mkv *.avi"), ("All files", "*.*")],
            initialdir=self._get_work_dir()
        )
        if f: 
            self.video_path_var.set(f)
            self.load_random_frame()

    def _browse_srt(self):
        f = filedialog.askopenfilename(
            title="Chọn file SRT",
            filetypes=[("SRT files", "*.srt"), ("All files", "*.*")],
            initialdir=self._get_work_dir()
        )
        if f: self.srt_path_var.set(f)

    def _browse_ass(self):
        f = filedialog.askopenfilename(
            title="Chọn file ASS",
            filetypes=[("ASS files", "*.ass"), ("All files", "*.*")],
            initialdir=self._get_work_dir()
        )
        if f: self.ass_path_var.set(f)

    def _on_mode_change(self):
        mode = self.mode_var.get()
        cursor = "tcross" if mode == "region" else "fleur" # Crosshair vs Move icon
        self.canvas.config(cursor=cursor)
        logging.info(f"Switched to {mode} mode")
    
    def _on_aspect_ratio_change(self):
        """Update display when aspect ratio changes"""
        if self.current_frame is not None:
            self.display_frame(self.current_frame)
        else:
            self.display_placeholder()

    def scan_drafts(self):
        logging.info("Scanning CapCut drafts...")
        try:
            # Try to find latest draft folder
            draft_root = self.default_draft_folder
            if not os.path.exists(draft_root):
                 draft_root = os.path.expanduser("~/Videos/CapCut Drafts")
            
            if not os.path.exists(draft_root):
                return

            # Find latest numeric folder
            folders = [f for f in os.listdir(draft_root) 
                      if os.path.isdir(os.path.join(draft_root, f)) and f.isdigit()]
            
            target_folder = draft_root
            if folders:
                latest = max(folders, key=int)
                target_folder = os.path.join(draft_root, latest)
            
            logging.info(f"Scanning in: {target_folder}")
            
            # Scan videos
            video_files = []
            video_map = {}
            for file in os.listdir(target_folder):
                file_path = os.path.join(target_folder, file)
                if os.path.isfile(file_path) and file.lower().endswith(('.mp4', '.avi', '.mkv', '.mov')):
                    folder_name = os.path.basename(target_folder)
                    display_name = f"{file} ({folder_name})"
                    video_files.append(display_name)
                    video_map[display_name] = file_path
            
            # Scan Subtitles (SRT + ASS)
            srt_files = []
            srt_map = {}
            ass_files = []
            ass_map = {}
            
            for file in os.listdir(target_folder):
                file_path = os.path.join(target_folder, file)
                if os.path.isfile(file_path):
                    if file.lower().endswith('.srt'):
                        folder_name = os.path.basename(target_folder)
                        display_name = f"{file} ({folder_name})"
                        srt_files.append(display_name)
                        srt_map[display_name] = file_path
                    elif file.lower().endswith('.ass'):
                        folder_name = os.path.basename(target_folder)
                        display_name = f"{file} ({folder_name})"
                        ass_files.append(display_name)
                        ass_map[display_name] = file_path
            
            self.video_file_map = video_map
            self.srt_file_map = srt_map
            self.ass_file_map = ass_map
            
            # Update Comboboxes
            if video_files:
                self.cb_video['values'] = video_files
                self.cb_video.config(postcommand="")
                logging.info(f"Tìm thấy {len(video_files)} videos")
            
            if srt_files:
                self.cb_srt['values'] = srt_files
                self.cb_srt.config(postcommand="")

            if ass_files:
                self.cb_ass['values'] = ass_files
                self.cb_ass.config(postcommand="")
                
        except Exception as e:
            logging.error(f"Error scanning drafts: {e}")

    def _on_video_selected(self, event):
        # 1. Try FileCombobox native logic (work_dir)
        full_path = self.cb_video.get_full_path()
        
        # 2. If valid locally scan map (CapCut drafts)
        if not full_path:
            display = self.cb_video.get()
            if display in self.video_file_map:
                full_path = self.video_file_map[display]
        
        if full_path and os.path.exists(full_path):
            self.video_path_var.set(full_path)
            self.load_random_frame()

    def _on_srt_selected(self, event):
        full_path = self.cb_srt.get_full_path()
        if not full_path:
            display = self.cb_srt.get()
            if display in self.srt_file_map:
                full_path = self.srt_file_map[display]
        if full_path and os.path.exists(full_path):
            self.srt_path_var.set(full_path)

    def _on_ass_selected(self, event):
        full_path = self.cb_ass.get_full_path()
        if not full_path:
            display = self.cb_ass.get()
            if display in self.ass_file_map:
                full_path = self.ass_file_map[display]
        if full_path and os.path.exists(full_path):
            self.ass_path_var.set(full_path)
            # Ensure we have something to draw on
            if self.current_frame is None and not self.placeholder_displayed:
                self.display_placeholder()
            self.show_caption_preview(full_path)

    def load_random_frame(self):
        vid = self.video_path_var.get()
        if not vid or not os.path.exists(vid):
            logging.warning("Chọn file video hợp lệ trước!")
            return
        
        logging.info(f"Loading random frame from {vid}...")
        try:
            cap = cv2.VideoCapture(vid)
            if not cap.isOpened():
                return
            
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            if total_frames > 0:
                random_frame = random.randint(0, total_frames - 1)
                cap.set(cv2.CAP_PROP_POS_FRAMES, random_frame)
                ret, frame = cap.read()
                if ret:
                    self.current_frame = frame
                    self.display_frame(frame)
                    # Update info label
                    self.lbl_canvas_info.config(text=f"Video: {os.path.basename(vid)} | Frame: {random_frame}/{total_frames}")
            cap.release()
        except Exception as e:
            logging.error(f"Load frame error: {e}")

    def display_placeholder(self):
        """Display a placeholder rectangle with selected aspect ratio"""
        self.canvas.update_idletasks()
        cw = self.canvas.winfo_width()
        ch = self.canvas.winfo_height()
        if cw < 10: cw = 800
        if ch < 10: ch = 600
        
        # Get aspect ratio
        ratio = self.aspect_ratio_var.get()
        if ratio == "16:9":
            aspect_w, aspect_h = 16, 9
        else:  # 6:9
            aspect_w, aspect_h = 6, 9
        
        # Calculate placeholder size to fit canvas
        target_ratio = aspect_w / aspect_h
        canvas_ratio = cw / ch
        
        # Padding: left/right = 2px, top/bottom = 10px
        padding_h = 2  # horizontal (left/right)
        padding_v = 10  # vertical (top/bottom)
        
        available_w = cw - (2 * padding_h)
        available_h = ch - (2 * padding_v)
        
        if (available_w / available_h) > target_ratio:
            # Canvas is wider - fit to height
            ph = available_h
            pw = int(ph * target_ratio)
        else:
            # Canvas is taller - fit to width
            pw = available_w
            ph = int(pw / target_ratio)
        
        # Clear and draw placeholder
        self.canvas.delete("all")
        
        # Center the placeholder
        cx, cy = cw // 2, ch // 2
        x1 = cx - pw // 2
        y1 = cy - ph // 2
        x2 = cx + pw // 2
        y2 = cy + ph // 2
        
        # Draw placeholder rectangle
        self.canvas.create_rectangle(x1, y1, x2, y2, 
                                     outline="#999999", 
                                     fill="#f5f5f5", 
                                     width=2, 
                                     dash=(10, 5))
        
        # Add text in center
        self.canvas.create_text(cx, cy, 
                               text=f"Chưa có video\nTỷ lệ: {ratio}\n{pw}x{ph}px", 
                               fill="#666666", 
                               font=("Arial", 14),
                               justify="center")
        
        # Store placeholder dimensions for interaction
        self.original_size = (pw, ph)
        self.scaled_size = (pw, ph)
        self.scale_ratio = 1.0
        self.image_offset_x = x1
        self.image_offset_y = y1
        self.placeholder_displayed = True
        
        # Update info
        self.lbl_canvas_info.config(text=f"Placeholder | Tỷ lệ: {ratio} | {pw}x{ph}px")
        
        # Redraw caption overlay
        self.draw_caption()

    def display_frame(self, frame):
        # Convert BGR to RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        image = Image.fromarray(frame_rgb)
        
        self.canvas.update_idletasks()
        cw = self.canvas.winfo_width() 
        ch = self.canvas.winfo_height()
        if cw < 10: cw = 800
        if ch < 10: ch = 600
        
        # Padding: left/right = 2px, top/bottom = 10px
        padding_h = 2  # horizontal
        padding_v = 10  # vertical
        
        available_w = cw - (2 * padding_h)
        available_h = ch - (2 * padding_v)
        
        iw, ih = image.size
    
        # Store ORIGINAL video dimensions (before any cropping)
        self.original_video_size = (iw, ih)
    
        # Get selected aspect ratio
        ratio = self.aspect_ratio_var.get()
        if ratio == "16:9":
            aspect_w, aspect_h = 16, 9
        else:  # 6:9
            aspect_w, aspect_h = 6, 9
        
        target_ratio = aspect_w / aspect_h
        image_ratio = iw / ih
        
        # Scale to fit canvas while maintaining selected aspect ratio
        # First crop/pad image to match target aspect ratio
        if abs(image_ratio - target_ratio) > 0.01:  # If ratios don't match
            if image_ratio > target_ratio:
                # Image is wider - crop width
                new_iw = int(ih * target_ratio)
                crop_x = (iw - new_iw) // 2
                image = image.crop((crop_x, 0, crop_x + new_iw, ih))
                iw = new_iw
            else:
                # Image is taller - crop height
                new_ih = int(iw / target_ratio)
                crop_y = (ih - new_ih) // 2
                image = image.crop((0, crop_y, iw, crop_y + new_ih))
                ih = new_ih
        
        # Now scale to fit available canvas area
        scale = min(available_w/iw, available_h/ih)
        
        if scale != 1.0:
            nw, nh = int(iw*scale), int(ih*scale)
            image = image.resize((nw, nh), Image.Resampling.LANCZOS)
            self.scale_ratio = scale
        else:
            self.scale_ratio = 1.0
            
        self.original_size = (iw, ih)
        self.scaled_size = image.size
        
        self.frame_image = ImageTk.PhotoImage(image)
        
        self.canvas.delete("all")
        cx, cy = cw//2, ch//2
        self.canvas_image_id = self.canvas.create_image(cx, cy, anchor="center", image=self.frame_image)
        
        self.image_offset_x = cx - image.width // 2
        self.image_offset_y = cy - image.height // 2
        
        self.placeholder_displayed = False
        
        # Reset region
        self.reset_region()
        
        # Redraw caption overlay
        self.draw_caption()

    def _on_canvas_resize(self, event):
        if self.current_frame is not None:
            self.display_frame(self.current_frame)
        else:
            self.display_placeholder() 

    def on_mouse_down(self, event):
        if self.mode_var.get() == "region":
            if self.current_frame is None: return
            x = event.x - self.image_offset_x
            y = event.y - self.image_offset_y
            
            if 0 <= x <= self.scaled_size[0] and 0 <= y <= self.scaled_size[1]:
                self.region_start = (int(x), int(y))
                if self.rect_id: self.canvas.delete(self.rect_id)
        elif self.mode_var.get() == "caption":
             # Check if clicked on caption
             # Canvas find_withtag("caption_preview") check overlap?
             # Simple: check if close to caption_preview_id
             items = self.canvas.find_overlapping(event.x-5, event.y-5, event.x+5, event.y+5)
             if self.caption_preview_id in items:
                 self.caption_drag_data["x"] = event.x
                 self.caption_drag_data["y"] = event.y
                 self.caption_drag_data["dragging"] = True

    def on_mouse_drag(self, event):
        if self.mode_var.get() == "region" and self.region_start:
            x = event.x - self.image_offset_x
            y = event.y - self.image_offset_y
            x = max(0, min(x, self.scaled_size[0]))
            y = max(0, min(y, self.scaled_size[1]))
            
            if self.rect_id: self.canvas.delete(self.rect_id)
            self.rect_id = self.canvas.create_rectangle(
                self.region_start[0] + self.image_offset_x,
                self.region_start[1] + self.image_offset_y,
                x + self.image_offset_x,
                y + self.image_offset_y,
                outline="#00ff00", width=2, dash=(5, 5)
            )
        elif self.mode_var.get() == "caption" and self.caption_drag_data.get("dragging"):
            dx = event.x - self.caption_drag_data["x"]
            dy = event.y - self.caption_drag_data["y"]
            self.canvas.move(self.caption_preview_id, dx, dy)
            self.caption_drag_data["x"] = event.x
            self.caption_drag_data["y"] = event.y
    def on_mouse_up(self, event):
        if self.mode_var.get() == "caption":
            self.caption_drag_data["dragging"] = False
            # Update saved coordinates for caption
            if self.caption_preview_id:
                coords = self.canvas.coords(self.caption_preview_id)
                # Save y relative to image
                # Canvas y -> Image y
                y_on_canvas = coords[1]
                y_on_image = y_on_canvas - self.image_offset_y
                
                # Normalize by scale
                orig_y = int(y_on_image / self.scale_ratio)
                
                self.saved_coordinates = {
                    "y": orig_y,
                    # We can store x too but usually centered
                    "x": int((coords[0] - self.image_offset_x) / self.scale_ratio)
                }
            return

        if self.mode_var.get() == "region" and self.region_start:
            x = event.x - self.image_offset_x
            y = event.y - self.image_offset_y
            x = max(0, min(x, self.scaled_size[0]))
            y = max(0, min(y, self.scaled_size[1]))
            
            self.region_end = (int(x), int(y))
            
            # Calculate rect
            x1 = min(self.region_start[0], self.region_end[0])
            y1 = min(self.region_start[1], self.region_end[1])
            x2 = max(self.region_start[0], self.region_end[0])
            y2 = max(self.region_start[1], self.region_end[1])
            
            # Update vars
            orig_x = int(x1 / self.scale_ratio)
            orig_y = int(y1 / self.scale_ratio)
            orig_w = int((x2 - x1) / self.scale_ratio)
            orig_h = int((y2 - y1) / self.scale_ratio)
            
            self.var_x.set(orig_x)
            self.var_y.set(orig_y)
            self.var_w.set(orig_w)
            self.var_h.set(orig_h)
            
            self.saved_coordinates = {"x": orig_x, "y": orig_y, "width": orig_w, "height": orig_h}
            
            # Margin V
            if self.original_size[1] > 0:
                margin_v = self.original_size[1] - orig_y
                self.lbl_margin_v.config(text=f"Margin-V: {margin_v}px")

    def reset_region(self):
        self.var_x.set(0); self.var_y.set(0)
        self.var_w.set(0); self.var_h.set(0)
        self.lbl_margin_v.config(text="Margin-V: 0px")
        if self.rect_id:
            self.canvas.delete(self.rect_id)
            self.rect_id = None
        self.saved_coordinates = None

    def pick_color(self):
        color = colorchooser.askcolor(title="Choose Subtitle Color")
        if color[1]:
            logging.info(f"Selected color: {color[1]}")
            # Could update a swatch if UI had one, but we just log for now or store it?
            # The original UI has an Entry for color? 
            # No, 'font_color_var' in original was Entry.
            # In CaptionTab UI, there isn't a dedicated color variable shown in setup_ui 
            # except local setup. Wait, setup_ui has no variable for color stored in self!
            self.selected_color = color[1]
            self.update_caption_style()

    def update_caption_style(self):
        if self.caption_preview_id:
            try:
                # Update font, size, color
                font_name = self.font_var.get()
                size = int(self.size_var.get())
                # Scale size
                scaled_size = int(size * self.scale_ratio)
                if scaled_size < 1: scaled_size = 1
                
                color = getattr(self, 'selected_color', "#FFFFFF")
                
                self.canvas.itemconfig(self.caption_preview_id, 
                                      font=(font_name, scaled_size, "bold"),
                                      fill=color)
            except Exception as e:
                pass

    def show_caption_preview(self, file_path):
        """Parse text from file and display it"""
        self.current_caption_text = get_sample_caption(file_path)
        self.draw_caption()
        
    def draw_caption(self):
        """Draw current caption text onto canvas"""
        if not self.current_caption_text:
            return
        
        # Update canvas idle tasks to get correct dimensions
        self.canvas.update_idletasks()
            
        # If ID exists but not on canvas (deleted by delete('all')), we need to recreate
        # But if it exists and is valid, delete it to re-create (simplest way to handle z-order on redraw)
        # Actually simplest: always delete if exists, then create new.
        if self.caption_preview_id:
            try:
                self.canvas.delete(self.caption_preview_id)
            except: 
                pass
            self.caption_preview_id = None
            
        # Draw new caption
        # Default pos: bottom center
        cw = self.canvas.winfo_width()
        ch = self.canvas.winfo_height()
        
        # Fallback if canvas not initialized
        if cw < 10: cw = 800
        if ch < 10: ch = 600
        
        cx = cw // 2
        cy = ch - 100 # Default margin
        
        # If we have saved coords, use them (mapped to current canvas)
        if self.saved_coordinates and "y" in self.saved_coordinates:
             orig_y = self.saved_coordinates["y"]
             # Recalculate based on current scale
             cy = int(orig_y * self.scale_ratio) + self.image_offset_y
             
             if "x" in self.saved_coordinates:
                 orig_x = self.saved_coordinates["x"]
                 cx = int(orig_x * self.scale_ratio) + self.image_offset_x
        
        font_name = self.font_var.get()
        try:
            size_val = self.size_var.get()
            size = int(size_val) if size_val else 48
        except:
            size = 48
            
        scaled_size = int(size * self.scale_ratio)
        if scaled_size < 1: scaled_size = 1
        
        # Color
        color = getattr(self, 'selected_color', "#FFFFFF")
        # Ensure color is hex
        if not color.startswith('#'): color = "#FFFFFF"

        try:
            self.caption_preview_id = self.canvas.create_text(
                cx, cy,
                text=self.current_caption_text,
                fill=color,
                font=(font_name, scaled_size, "bold"),
                anchor="center",
                tags="caption"
            )
        except Exception as e:
            logging.error(f"Error drawing caption: {e}")

    
    def run_convert_ass(self):
        srt_path = self.srt_path_var.get()
        if not srt_path or not os.path.exists(srt_path):
            messagebox.showwarning("Warning", "Chọn file SRT hợp lệ!")
            return
            
        try:
            # Create output filename
            folder = os.path.dirname(srt_path)
            name = os.path.splitext(os.path.basename(srt_path))[0]
            ass_path = os.path.join(folder, f"{name}.ass")
            
            # Get settings from UI
            font_name = self.font_var.get()
            # Map display name to actual font family
            if font_name == "Tiên Nữ":
                font_name = "ZYVNA Fairy"
                
            font_size = self.size_var.get()
            try:
                font_size = int(font_size)
            except:
                font_size = 48
                
            font_color = getattr(self, 'selected_color', "#FFFFFF") # fallback if not set
            
            # Get video dims for positioning
            w, h = 1920, 1080
            if hasattr(self, 'original_size') and self.original_size[0] > 0:
                w, h = self.original_size
            
            # Check for saved coordinates (region/caption)
            position = None
            margin_v = 50
            
            if self.saved_coordinates:
                 # If saved coords are from Region (x,y,w,h)
                 if "width" in self.saved_coordinates and self.saved_coordinates["width"] > 0:
                      # Not supporting region-based auto-positioning logic yet here for simple conversion,
                      # unless we want to put text in that region? 
                      # For now let's just stick to standard bottom or explicit position logic if implied.
                      
                      # Actually, if the user selected a region, maybe they want the text THERE?
                      # Let's use the center of the region for pos
                      cw = self.saved_coordinates["width"]
                      ch = self.saved_coordinates["height"]
                      cx = self.saved_coordinates["x"] + cw // 2
                      cy = self.saved_coordinates["y"] + ch // 2
                      position = (cx, cy)
                      
                 elif "y" in self.saved_coordinates:
                      # If just Y (caption drag)
                      y = self.saved_coordinates["y"]
                      # X center?
                      x = w // 2
                      position = (x, y)
            
            # Call backend
            shadow_value = getattr(self, 'default_shadow', 2)
            success = convert_srt_to_ass(
                srt_path=srt_path,
                ass_path=ass_path,
                video_resolution=(w, h),
                font_name=font_name,
                font_size=font_size,
                font_color=font_color,
                margin_v=margin_v,
                position=position,
                shadow=shadow_value
            )
            
            if success:
                messagebox.showinfo("Thành công", f"Đã convert sang ASS:\n{ass_path}")
                # Auto select new ASS
                self.ass_path_var.set(ass_path)
            
        except Exception as e:
            logging.error(f"Convert error: {e}")
            messagebox.showerror("Lỗi", str(e))

    def render_video_from_ass(self):
        """Render video from ASS file with black background"""
        ass_path = self.ass_path_var.get()
        srt_path = self.srt_path_var.get()
        
        # Need either ASS or SRT
        if (not ass_path or not os.path.exists(ass_path)) and (not srt_path or not os.path.exists(srt_path)):
            messagebox.showwarning("Warning", "Chọn file SRT hoặc ASS hợp lệ!")
            return
        
        try:
            # Get current UI settings
            font_name = self.font_var.get()
            # Map display name to actual font family
            if font_name == "Tiên Nữ":
                font_name = "ZYVNA Fairy"
                
            try:
                font_size = int(self.size_var.get())
            except:
                font_size = 32
            font_color = getattr(self, 'selected_color', '#FFFF00')
            shadow_value = getattr(self, 'default_shadow', 4)
            
            logging.info(f"UI Settings - Font: {font_name}, Size: {font_size}, Color: {font_color}")
            
            # Auto-calculate dimensions for caption strip
            # Width: Use original video width (before cropping)
            if hasattr(self, 'original_video_size') and self.original_video_size[0] > 0:
                strip_width = self.original_video_size[0]
                logging.info(f"Using video width: {strip_width}px")
            else:
                strip_width = 1920  # Default if no video loaded
                logging.info(f"Using default width: {strip_width}px (no video loaded)")
            
            # Height: Font size + 40px padding (20px top + 20px bottom), rounded to even number
            strip_height = font_size + 40
            if strip_height % 2 != 0:
                strip_height += 1  # Round up to even number
            logging.info(f"Calculated height: {font_size} (font) + 40 (padding) = {strip_height}px (even)")
            
            # Update UI display (for info only)
            self.render_width_var.set(str(strip_width))
            self.render_height_var.set(str(strip_height))
            
            # Get video dimensions for ASS resolution
            w, h = strip_width, strip_height
            
            # If SRT missing, try to find it from ASS path
            if (not srt_path or not os.path.exists(srt_path)) and ass_path:
                potential_srt = os.path.splitext(ass_path)[0] + ".srt"
                if os.path.exists(potential_srt):
                    srt_path = potential_srt
                    logging.info(f"Auto-detected SRT: {srt_path}")
            
            # If still no SRT in strip mode -> Error or Warning
            if (not srt_path or not os.path.exists(srt_path)) and height < 200:
                messagebox.showwarning("Cảnh báo", 
                    "Không tìm thấy file SRT!\n\n"
                    "Chế độ 'Caption Strip' cần file SRT gốc để tạo subtitle khớp với kích thước video.\n"
                    "Vui lòng chọn file SRT.")
                return
            
            # If we have SRT, regenerate ASS with current settings
            if srt_path and os.path.exists(srt_path):
                logging.info("Regenerating ASS with current UI settings...")
                folder = os.path.dirname(srt_path)
                name = os.path.splitext(os.path.basename(srt_path))[0]
                ass_path_temp = os.path.join(folder, f"{name}_strip.ass")
                
                # Get position (center horizontally, vertically centered in strip)
                position = None
                margin_v = 20  # Ensure 20px from bottom
                
                # Convert with current settings
                success = convert_srt_to_ass(
                    srt_path=srt_path,
                    ass_path=ass_path_temp,
                    video_resolution=(w, h),
                    font_name=font_name,
                    font_size=font_size,
                    font_color=font_color,
                    margin_v=margin_v,
                    position=position,
                    shadow=shadow_value,
                    alignment=2  # Bottom Center (guarantees bottom margin)
                )
                
                if success:
                    ass_path = ass_path_temp
                    logging.info(f"ASS regenerated with: font={font_name}, size={font_size}, color={font_color}")
                    logging.info(f"Strip dimensions: {strip_width}x{strip_height}")
                else:
                    messagebox.showerror("Lỗi", "Không thể tạo ASS từ SRT!")
                    return
            
            # Get render parameters
            width = strip_width
            height = strip_height
            
            padding_input = self.render_padding_var.get().strip()
            
            # Determine padding
            try:
                padding = float(padding_input)
            except:
                padding = 0.0
                
            # Import backend function
            from app.core.caption_funtion import render_ass_to_video, get_ass_duration

            # Calculate total duration
            base_duration = get_ass_duration(ass_path)
            if base_duration is None:
                base_duration = 10 # Fallback
            
            duration = base_duration + padding
            logging.info(f"Duration calculation: Base={base_duration}s + Padding={padding}s = {duration}s")
            
            # Create output filename
            folder = os.path.dirname(ass_path)
            name = os.path.splitext(os.path.basename(ass_path))[0]
            # Remove _strip suffix if exists to avoid double naming
            if name.endswith('_strip'):
                name = name[:-6]
            output_path = os.path.join(folder, f"{name}_strip.mov")
            
            # Import backend function - moved up
            # from app.core.caption_funtion import render_ass_to_video
            
            logging.info(f"Starting caption strip render: {width}x{height}, duration={duration}")
            
            
            # Run in thread to avoid blocking UI
            def render_thread():
                try:
                    # Enable stop button, reset progress
                    def enable_ui():
                        self.render_stop_btn.config(state='normal')
                        self.render_progress['value'] = 0
                        self.render_progress_label.config(text="Bắt đầu...")
                    self.frame.after(0, enable_ui)
                    
                    # Progress callback (thread-safe)
                    def update_progress(frame, total, fps, message):
                        def ui_update():
                            percent = min(100, int((frame / total) * 100)) if total > 0 else 0
                            self.render_progress['value'] = percent
                            self.render_progress_label.config(text=f"Frame {frame}/{total} - {message}")
                        self.frame.after(0, ui_update)
                    
                    # Get encoding method from UI
                    use_gpu = (self.encoding_method_var.get() == "gpu")
                    
                    success, process = render_ass_to_video(
                        ass_path=ass_path,
                        output_path=output_path,
                        width=width,
                        height=height,
                        duration=duration,
                        use_gpu=use_gpu,
                        progress_callback=update_progress
                    )
                    
                    # Stop progress (thread-safe)
                    def finish_ui():
                        self.render_progress['value'] = 100 if success else 0
                        self.render_stop_btn.config(state='disabled')
                        if success:
                            self.render_progress_label.config(text="✅ Hoàn thành!")
                            logging.info(f"Video rendered successfully: {output_path}")
                        else:
                            self.render_progress_label.config(text="❌ Render thất bại")
                            logging.error("Render failed")
                        self.render_process = None
                    
                    self.frame.after(0, finish_ui)
                    
                except Exception as e:
                    logging.error(f"Render error: {e}")
                    def error_ui():
                        self.render_progress['value'] = 0
                        self.render_stop_btn.config(state='disabled')
                        self.render_progress_label.config(text=f"❌ Lỗi: {str(e)[:30]}")
                        self.render_process = None
                    self.frame.after(0, error_ui)
            
            thread = threading.Thread(target=render_thread, daemon=True)
            thread.start()
            
        except ValueError:
            messagebox.showerror("Lỗi", "Width và Height phải là số nguyên!")
        except Exception as e:
            logging.error(f"Render setup error: {e}")
            messagebox.showerror("Lỗi", str(e))
    
    def stop_render(self):
        """Stop the rendering process"""
        if self.render_process:
            try:
                self.render_process.terminate()
                self.render_process = None
                self.render_progress.stop()
                self.render_stop_btn.config(state='disabled')
                self.render_progress_label.config(text="❌ Đã dừng")
                logging.info("Render stopped by user")
            except Exception as e:
                logging.error(f"Error stopping render: {e}")

    def get_frame(self):
        return self.frame
