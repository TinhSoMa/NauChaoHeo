#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Module xử lý chức năng chọn vùng video
- Hiển thị frame ngẫu nhiên từ video
- Cho phép chọn vùng trên frame
- Lưu tọa độ vùng đã chọn
"""

import cv2
import json
import os
import numpy as np
import random
from PIL import Image, ImageTk
import tkinter as tk
from tkinter import filedialog, messagebox


class VideoRegionSelector:
    """Class xử lý việc chọn vùng trên video"""
    
    def __init__(self, parent_frame, log_callback=None):
        """
        Khởi tạo VideoRegionSelector
        
        Args:
            parent_frame: Frame cha để chứa các widgets
            log_callback: Hàm callback để ghi log
        """
        self.parent_frame = parent_frame
        self.log = log_callback if log_callback else print
        
        # Default draft folder - CÓ THỂ CHỈNH SỬA THEO Ý BẠN
        self.default_draft_folder = "D:/User/CongTinh/Videos/CapCut Drafts/1223"
        
        # Fallback nếu folder không tồn tại
        if not os.path.exists(self.default_draft_folder):
            # Thử tìm folder mới nhất
            capcut_base = os.path.expanduser("~/Videos/CapCut Drafts")
            if not os.path.exists(capcut_base):
                capcut_base = "D:/User/CongTinh/Videos/CapCut Drafts"
            
            # Tìm folder mới nhất (số lớn nhất)
            if os.path.exists(capcut_base):
                folders = [f for f in os.listdir(capcut_base) 
                          if os.path.isdir(os.path.join(capcut_base, f)) and f.isdigit()]
                if folders:
                    latest = max(folders, key=int)
                    self.default_draft_folder = os.path.join(capcut_base, latest)
        
        self.video_path = None
        self.video_path_var = tk.StringVar()
        self.current_frame = None
        self.frame_image = None
        self.canvas_image_id = None
        
        # Scaling variables
        self.scale_ratio = 1.0
        self.original_size = (0, 0)
        self.scaled_size = (0, 0)
        self.image_offset_x = 0
        self.image_offset_y = 0
        
        # Tọa độ vùng chọn
        self.region_start = None
        self.region_end = None
        self.rect_id = None
        
        # SRT and Font variables
        self.srt_path_var = tk.StringVar()
        self.font_name_var = tk.StringVar(value="ZYVNA Fairy")
        self.font_size_var = tk.StringVar(value="48")
        self.font_color_var = tk.StringVar(value="#FFFFFF")
        
        # Saved coordinates
        self.saved_coordinates = None
        
        # Caption preview
        self.caption_preview_id = None
        
        # Selection mode: True = Region, False = Caption
        self.region_selection_enabled = True
        
        self.create_widgets()
    
    def create_widgets(self):
        """Tạo giao diện cho tab vùng video - Tối ưu compact"""
        
        # Controls frame - minimal height
        control_frame = tk.Frame(self.parent_frame, bg="#f8f9fa", relief="solid", borderwidth=1)
        control_frame.pack(fill="x", padx=0, pady=0)
        
        control_content = tk.Frame(control_frame, bg="#f8f9fa")
        control_content.pack(fill="x", padx=10, pady=8)
        
        # === ROW 1: Files + Quick Actions ===
        row1 = tk.Frame(control_content, bg="#f8f9fa")
        row1.pack(fill="x", pady=(0, 6))
        
        # Import ttk
        from tkinter import ttk
        
        # Video section
        tk.Label(row1, text="Video:", font=("Segoe UI", 9, "bold"), bg="#f8f9fa", fg="#495057", width=6).pack(side="left")
        
        # Video combobox
        self.video_combo = ttk.Combobox(
            row1, textvariable=self.video_path_var,
            font=("Segoe UI", 9), width=32, state="normal"
        )
        self.video_combo.pack(side="left", ipady=2)
        
        tk.Button(
            row1, text="📂", command=self.browse_video,
            bg="#6f42c1", fg="white", font=("Segoe UI", 10, "bold"),
            width=3, pady=2, cursor="hand2", relief="flat"
        ).pack(side="left", padx=3)
        
        tk.Button(
            row1, text="🎲", command=self.load_random_frame,
            bg="#0078d4", fg="white", font=("Segoe UI", 10, "bold"),
            width=3, pady=2, cursor="hand2", relief="flat", 
        ).pack(side="left", padx=(0, 12))
        
        # SRT section
        tk.Label(row1, text="SRT:", font=("Segoe UI", 9, "bold"), bg="#f8f9fa", fg="#495057", width=5).pack(side="left")
        
        # SRT combobox
        self.srt_combo = ttk.Combobox(
            row1, textvariable=self.srt_path_var,
            font=("Segoe UI", 9), width=27, state="normal"
        )
        self.srt_combo.pack(side="left", ipady=2)
        
        tk.Button(
            row1, text="📄", command=self.browse_srt,
            bg="#6f42c1", fg="white", font=("Segoe UI", 10, "bold"),
            width=3, pady=2, cursor="hand2", relief="flat"
        ).pack(side="left", padx=3)
        
        # ASS section (optional)

        
        # Scan CapCut drafts để populate comboboxes
        self._populate_file_lists()
        
        # === ROW 2: Font + Actions ===
        row2 = tk.Frame(control_content, bg="#f8f9fa")
        row2.pack(fill="x")
        
        # Font settings
        tk.Label(row2, text="Font:", font=("Segoe UI", 9, "bold"), bg="#f8f9fa", fg="#495057", width=6).pack(side="left")
        
        from tkinter import ttk
        fonts = ["ZYVNA Fairy", "Be Vietnam Pro", "Roboto", "Inter", "Montserrat", "Arial", "Noto Sans"]
        ttk.Combobox(
            row2, textvariable=self.font_name_var, values=fonts,
            font=("Segoe UI", 9), width=15, state="readonly"
        ).pack(side="left", ipady=1, padx=(0, 8))
        
        tk.Label(row2, text="Size:", font=("Segoe UI", 9), bg="#f8f9fa", fg="#495057").pack(side="left", padx=(0, 3))
        
        tk.Spinbox(
            row2, textvariable=self.font_size_var, from_=20, to=150, increment=2,
            font=("Segoe UI", 9), width=5, relief="solid", borderwidth=1
        ).pack(side="left", ipady=1, padx=(0, 8))
        
        tk.Label(row2, text="Color:", font=("Segoe UI", 9), bg="#f8f9fa", fg="#495057").pack(side="left", padx=(0, 3))
        
        tk.Entry(
            row2, textvariable=self.font_color_var,
            font=("Segoe UI", 9), width=8, relief="solid", borderwidth=1
        ).pack(side="left", ipady=2)
        
        # Color presets (compact)
        colors = [("#FFFFFF", "W", "#000"), ("#FFEB3B", "Y", "#000"), 
                  ("#FF5722", "R", "#FFF"), ("#00E5FF", "C", "#000")]
        
        for bg_color, label, fg_color in colors:
            tk.Button(
                row2, text=label, command=lambda c=bg_color: self.font_color_var.set(c),
                bg=bg_color, fg=fg_color, font=("Segoe UI", 8, "bold"),
                width=2, pady=1, cursor="hand2", relief="solid", borderwidth=1
            ).pack(side="left", padx=1)
        
        # === Action Buttons (grouped) ===
        # Separator
        tk.Label(row2, text="│", font=("Segoe UI", 12), bg="#f8f9fa", fg="#dee2e6").pack(side="left", padx=8)
        

        
        # Mode toggle
        self.mode_button = tk.Button(
            row2, text="� Vùng",
            command=self.toggle_selection_mode,
            bg="#ffc107", fg="black", font=("Segoe UI", 9, "bold"),
            padx=8, pady=3, cursor="hand2", relief="flat"
        )
        self.mode_button.pack(side="left", padx=2)
        
        # Info labels
        self.region_info_label = tk.Label(
            row2, text="", font=("Segoe UI", 8, "bold"), bg="#f8f9fa", fg="#6f42c1"
        )
        self.region_info_label.pack(side="left", padx=(10, 0))
        
        # Saved coordinates display
        tk.Label(
            row2, text="📌", font=("Segoe UI", 9), bg="#f8f9fa", fg="#28a745"
        ).pack(side="left", padx=(12, 3))
        
        self.saved_coords_label = tk.Label(
            row2, text="Chưa lưu", font=("Segoe UI", 8), bg="#f8f9fa", fg="#666"
        )
        self.saved_coords_label.pack(side="left")
        
        # Canvas frame - maximized
        canvas_frame = tk.Frame(self.parent_frame, bg="#2d2d2d", relief="solid", borderwidth=1)
        canvas_frame.pack(fill="both", expand=True)
        
        # Canvas with scrollbars
        self.canvas = tk.Canvas(
            canvas_frame, bg="#2d2d2d", cursor="crosshair",
            highlightthickness=0
        )
        
        h_scrollbar = tk.Scrollbar(canvas_frame, orient="horizontal", command=self.canvas.xview)
        v_scrollbar = tk.Scrollbar(canvas_frame, orient="vertical", command=self.canvas.yview)
        
        self.canvas.configure(xscrollcommand=h_scrollbar.set, yscrollcommand=v_scrollbar.set)
        
        # Grid layout for canvas and scrollbars
        self.canvas.grid(row=0, column=0, sticky="nsew")
        h_scrollbar.grid(row=1, column=0, sticky="ew")
        v_scrollbar.grid(row=0, column=1, sticky="ns")
        
        canvas_frame.rowconfigure(0, weight=1)
        canvas_frame.columnconfigure(0, weight=1)
        
        # Bind mouse events for region selection
        self.canvas.bind("<ButtonPress-1>", self.on_mouse_down)
        self.canvas.bind("<B1-Motion>", self.on_mouse_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_mouse_up)
        
        # Initial placeholder
        self.show_placeholder()
    
    def show_placeholder(self):
        """Hiển thị placeholder khi chưa có video"""
        self.canvas.delete("all")
        self.canvas.create_text(
            400, 300,
            text="📹 Chọn video và nhấn 'Random Frame'",
            font=("Segoe UI", 11), fill="#666666", justify="center"
        )
    
    def _populate_file_lists(self):
        """Scan default draft folder và populate combobox dropdowns"""
        try:
            if not os.path.exists(self.default_draft_folder):
                return
            
            # Scan videos (chỉ trong folder này, không recursive)
            video_files = []
            video_map = {}
            for file in os.listdir(self.default_draft_folder):
                file_path = os.path.join(self.default_draft_folder, file)
                if os.path.isfile(file_path) and file.lower().endswith(('.mp4', '.avi', '.mkv', '.mov')):
                    folder_name = os.path.basename(self.default_draft_folder)
                    display_name = f"{file} ({folder_name})"
                    video_files.append(display_name)
                    video_map[display_name] = file_path
            
            # Scan SRT
            srt_files = []
            srt_map = {}
            for file in os.listdir(self.default_draft_folder):
                file_path = os.path.join(self.default_draft_folder, file)
                if os.path.isfile(file_path) and file.lower().endswith('.srt'):
                    folder_name = os.path.basename(self.default_draft_folder)
                    display_name = f"{file} ({folder_name})"
                    srt_files.append(display_name)
                    srt_map[display_name] = file_path
            
            # Save mappings
            self.video_file_map = video_map
            self.srt_file_map = srt_map
            
            # Populate comboboxes
            self.video_combo['values'] = video_files
            self.srt_combo['values'] = srt_files
            
            # Bind selection events
            self.video_combo.bind('<<ComboboxSelected>>', self._on_video_selected)
            self.srt_combo.bind('<<ComboboxSelected>>', self._on_srt_selected)
            
            # Log
            try:
                self.log(f"📂 {os.path.basename(self.default_draft_folder)}: {len(video_files)} videos, {len(srt_files)} SRTs")
            except:
                pass
            
        except Exception as e:
            pass
    
    def _on_video_selected(self, event):
        """Convert display name to full path"""
        display_name = self.video_combo.get()
        if display_name in self.video_file_map:
            full_path = self.video_file_map[display_name]
            self.video_path_var.set(full_path)
            self.video_path = full_path
            # Auto-load random frame
            self.load_random_frame()
    
    def _on_srt_selected(self, event):
        """Convert display name to full path"""
        display_name = self.srt_combo.get()
        if display_name in self.srt_file_map:
            full_path = self.srt_file_map[display_name]
            self.srt_path_var.set(full_path)
    
    def _on_ass_selected(self, event):
        """Convert display name to full path"""
        display_name = self.ass_combo.get()
        if display_name in self.ass_file_map:
            full_path = self.ass_file_map[display_name]
            self.ass_path_var.set(full_path)
            # TODO: Auto-load caption preview (method chưa implement)
            # if self.current_frame is not None:
            #     self._parse_and_show_caption(full_path)
    
    def browse_video(self):
        """Scan và chọn video từ CapCut drafts"""
        # Scan videos
        video_files = []
        for root, dirs, files in os.walk(self.capcut_base):
            for file in files:
                if file.lower().endswith(('.mp4', '.avi', '.mkv', '.mov')):
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, self.capcut_base)
                    video_files.append((file, full_path, rel_path))
        
        if not video_files:
            # Fallback to normal browse
            filename = filedialog.askopenfilename(
                title="Chọn file video",
                filetypes=[("Video files", "*.mp4;*.avi;*.mkv;*.mov"), ("All files", "*.*")]
            )
            if filename:
                self.video_path = filename
                self.video_path_var.set(filename)
                self.log(f"✅ Video: {filename}")
                self.load_random_frame()
            return
        
        # Show selection dialog
        selected = self._show_file_selection_dialog(
            "Chọn Video từ CapCut Drafts",
            video_files
        )
        if selected:
            self.video_path = selected
            self.video_path_var.set(selected)
            self.log(f"✅ Video: {selected}")
            self.load_random_frame()
    
    def browse_srt(self):
        """Scan và chọn SRT từ CapCut drafts"""
        # Scan SRT files
        srt_files = []
        for root, dirs, files in os.walk(self.capcut_base):
            for file in files:
                if file.lower().endswith('.srt'):
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, self.capcut_base)
                    srt_files.append((file, full_path, rel_path))
        
        if not srt_files:
            # Fallback to normal browse
            filename = filedialog.askopenfilename(
                title="Chọn file SRT",
                filetypes=[("SRT files", "*.srt"), ("All files", "*.*")]
            )
            if filename:
                self.srt_path_var.set(filename)
                self.log(f"✅ SRT: {filename}")
            return
        
        # Show selection dialog
        selected = self._show_file_selection_dialog(
            "Chọn SRT từ CapCut Drafts",
            srt_files
        )
        if selected:
            self.srt_path_var.set(selected)
            self.log(f"✅ SRT: {selected}")
    
    def browse_ass(self):
        """Scan và chọn ASS từ CapCut drafts"""
        # Scan ASS files
        ass_files = []
        for root, dirs, files in os.walk(self.capcut_base):
            for file in files:
                if file.lower().endswith('.ass'):
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, self.capcut_base)
                    ass_files.append((file, full_path, rel_path))
        
        if not ass_files:
            # Fallback to normal browse
            filename = filedialog.askopenfilename(
                title="Chọn file ASS",
                filetypes=[("ASS files", "*.ass"), ("All files", "*.*")]
            )
            if filename:
                self.ass_path_var.set(filename)
                self.log(f"✅ ASS: {filename}")
                if self.current_frame is not None:
                    self._parse_and_show_caption(filename)
            return
        
        # Show selection dialog
        selected = self._show_file_selection_dialog(
            "Chọn ASS từ CapCut Drafts",
            ass_files
        )
        if selected:
            self.ass_path_var.set(selected)
            self.log(f"✅ ASS: {selected}")
            if self.current_frame is not None:
                self._parse_and_show_caption(selected)
    
    def _show_file_selection_dialog(self, title, files):
        """Hiển thị dialog để chọn file từ list"""
        dialog = tk.Toplevel(self.parent_frame)
        dialog.title(title)
        dialog.geometry("800x500")
        dialog.transient(self.parent_frame)
        
        # Center dialog
        dialog.update_idletasks()
        x = (dialog.winfo_screenwidth() // 2) - 400
        y = (dialog.winfo_screenheight() // 2) - 250
        dialog.geometry(f"+{x}+{y}")
        
        selected_file = [None]
        
        # Header
        tk.Label(
            dialog, text=f"Tìm thấy {len(files)} files",
            font=("Segoe UI", 10, "bold"), bg="#f8f9fa"
        ).pack(fill="x", pady=10)
        
        # Listbox with scrollbar
        list_frame = tk.Frame(dialog)
        list_frame.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        
        scrollbar = tk.Scrollbar(list_frame)
        scrollbar.pack(side="right", fill="y")
        
        listbox = tk.Listbox(
            list_frame, yscrollcommand=scrollbar.set,
            font=("Consolas", 9), selectmode="single"
        )
        listbox.pack(side="left", fill="both", expand=True)
        scrollbar.config(command=listbox.yview)
        
        # Populate list
        for filename, full_path, rel_path in files:
            listbox.insert(tk.END, f"{filename} ({rel_path})")
        
        # Double click to select
        def on_double_click(event):
            selection = listbox.curselection()
            if selection:
                idx = selection[0]
                selected_file[0] = files[idx][1]  # full_path
                dialog.destroy()
        
        listbox.bind("<Double-Button-1>", on_double_click)
        
        # Buttons
        btn_frame = tk.Frame(dialog)
        btn_frame.pack(fill="x", padx=10, pady=10)
        
        def on_select():
            selection = listbox.curselection()
            if selection:
                idx = selection[0]
                selected_file[0] = files[idx][1]
                dialog.destroy()
            else:
                messagebox.showwarning("Chưa chọn", "Vui lòng chọn 1 file")
        
        tk.Button(
            btn_frame, text="✅ Chọn", command=on_select,
            bg="#28a745", fg="white", font=("Segoe UI", 10, "bold"),
            padx=20, pady=5, cursor="hand2"
        ).pack(side="left", padx=5)
        
        tk.Button(
            btn_frame, text="❌ Hủy", command=dialog.destroy,
            bg="#dc3545", fg="white", font=("Segoe UI", 10, "bold"),
            padx=20, pady=5, cursor="hand2"
        ).pack(side="left", padx=5)
        
        dialog.wait_window()
        return selected_file[0]
    
    def load_random_frame(self):
        """Lấy một frame ngẫu nhiên từ video và hiển thị"""
        if not self.video_path:
            messagebox.showerror("Lỗi", "Vui lòng chọn file video trước!")
            return
        
        try:
            # Mở video
            cap = cv2.VideoCapture(self.video_path)
            if not cap.isOpened():
                messagebox.showerror("Lỗi", "Không thể mở file video!")
                return
            
            # Lấy tổng số frame
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            if total_frames <= 0:
                messagebox.showerror("Lỗi", "Video không có frame nào!")
                cap.release()
                return
            
            # Chọn frame ngẫu nhiên
            random_frame_number = random.randint(0, total_frames - 1)
            cap.set(cv2.CAP_PROP_POS_FRAMES, random_frame_number)
            
            # Đọc frame
            ret, frame = cap.read()
            cap.release()
            
            if not ret:
                messagebox.showerror("Lỗi", "Không thể đọc frame từ video!")
                return
            
            # Lưu frame hiện tại
            self.current_frame = frame
            
            # Hiển thị frame
            self.display_frame(frame)
            
            self.log(f"✅ Đã lấy frame #{random_frame_number} từ video (tổng {total_frames} frames)")
            
        except Exception as e:
            messagebox.showerror("Lỗi", f"Lỗi khi xử lý video:\n{str(e)}")
            self.log(f"❌ Lỗi: {str(e)}")
    
    def display_frame(self, frame):
        """Hiển thị frame lên canvas - tự động scale để fit"""
        # Convert BGR to RGB
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Convert to PIL Image
        image = Image.fromarray(frame_rgb)
        
        # Lấy kích thước canvas
        self.canvas.update_idletasks()
        canvas_width = self.canvas.winfo_width()
        canvas_height = self.canvas.winfo_height()
        
        # Nếu canvas chưa render (kích thước = 1), dùng default
        if canvas_width <= 1 or canvas_height <= 1:
            canvas_width = 800
            canvas_height = 600
        
        # Tính tỷ lệ scale để fit vào canvas (giữ aspect ratio)
        img_width, img_height = image.size
        scale_w = canvas_width / img_width
        scale_h = canvas_height / img_height
        scale = min(scale_w, scale_h, 1.0)  # Không phóng to quá kích thước gốc
        
        # Scale image nếu cần
        if scale < 1.0:
            new_width = int(img_width * scale)
            new_height = int(img_height * scale)
            image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
            self.scale_ratio = scale
        else:
            self.scale_ratio = 1.0
        
        # Lưu kích thước gốc và scaled
        self.original_size = (img_width, img_height)
        self.scaled_size = image.size
        
        # Convert to PhotoImage
        self.frame_image = ImageTk.PhotoImage(image)
        
        # Update canvas size (không cần scrollregion vì đã fit)
        self.canvas.config(scrollregion=(0, 0, image.width, image.height))
        
        # Display image ở giữa canvas
        self.canvas.delete("all")
        canvas_center_x = canvas_width // 2
        canvas_center_y = canvas_height // 2
        self.canvas_image_id = self.canvas.create_image(
            canvas_center_x, canvas_center_y, anchor="center", image=self.frame_image
        )
        
        # Lưu offset để tính toán tọa độ đúng
        self.image_offset_x = canvas_center_x - image.width // 2
        self.image_offset_y = canvas_center_y - image.height // 2
        
        # Reset region
        self.region_start = None
        self.region_end = None
        self.rect_id = None
        self.update_region_info()
    
    def on_mouse_down(self, event):
        """Xử lý khi nhấn chuột xuống"""
        # Chỉ vẽ vùng khi ở Region mode
        if not self.region_selection_enabled:
            return
        
        if self.current_frame is None:
            return
        
        # Lấy tọa độ trên canvas (adjusted với offset)
        x = event.x - self.image_offset_x
        y = event.y - self.image_offset_y
        
        # Kiểm tra xem click có nằm trong ảnh không
        if x < 0 or y < 0 or x > self.scaled_size[0] or y > self.scaled_size[1]:
            return
        
        # Lưu tọa độ (trên scaled image)
        self.region_start = (int(x), int(y))
        
        # Xóa rectangle cũ nếu có
        if self.rect_id:
            self.canvas.delete(self.rect_id)
    
    def on_mouse_drag(self, event):
        """Xử lý khi kéo chuột"""
        if self.current_frame is None or self.region_start is None:
            return
        
        # Lấy tọa độ (adjusted)
        x = event.x - self.image_offset_x
        y = event.y - self.image_offset_y
        
        # Giới hạn trong ảnh
        x = max(0, min(x, self.scaled_size[0]))
        y = max(0, min(y, self.scaled_size[1]))
        
        # Xóa rectangle cũ
        if self.rect_id:
            self.canvas.delete(self.rect_id)
        
        # Vẽ rectangle mới (tọa độ canvas = tọa độ scaled + offset)
        self.rect_id = self.canvas.create_rectangle(
            self.region_start[0] + self.image_offset_x, 
            self.region_start[1] + self.image_offset_y,
            x + self.image_offset_x, 
            y + self.image_offset_y,
            outline="#00ff00", width=2, dash=(5, 5)
        )
    
    def on_mouse_up(self, event):
        """Xử lý khi thả chuột"""
        if self.current_frame is None or self.region_start is None:
            return
        
        # Lấy tọa độ (adjusted)
        x = event.x - self.image_offset_x
        y = event.y - self.image_offset_y
        
        # Giới hạn trong ảnh
        x = max(0, min(x, self.scaled_size[0]))
        y = max(0, min(y, self.scaled_size[1]))
        
        self.region_end = (int(x), int(y))
        
        # Tính toán vùng (đảm bảo x1 < x2, y1 < y2) - tọa độ trên scaled image
        x1 = min(self.region_start[0], self.region_end[0])
        y1 = min(self.region_start[1], self.region_end[1])
        x2 = max(self.region_start[0], self.region_end[0])
        y2 = max(self.region_start[1], self.region_end[1])
        
        # Lưu tọa độ scaled
        self.region_start = (x1, y1)
        self.region_end = (x2, y2)
        
        # Cập nhật thông tin
        self.update_region_info()
        
        # Log tọa độ (đã convert về ảnh gốc)
        orig_x1 = int(x1 / self.scale_ratio)
        orig_y1 = int(y1 / self.scale_ratio)
        orig_width = int((x2 - x1) / self.scale_ratio)
        orig_height = int((y2 - y1) / self.scale_ratio)
        
        # Auto-save tọa độ
        self.saved_coordinates = {
            "x": orig_x1,
            "y": orig_y1,
            "width": orig_width,
            "height": orig_height
        }
        
        # Cập nhật saved label
        self.saved_coords_label.config(
            text=f"({orig_x1}, {orig_y1}) | {orig_width}x{orig_height}px",
            fg="#28a745"
        )
        
        self.log(f"🎯 Vùng chọn (ảnh gốc): x={orig_x1}, y={orig_y1}, w={orig_width}, h={orig_height}")
        self.log(f"💾 Tọa độ đã tự động lưu")
    
    def update_region_info(self):
        """Cập nhật thông tin vùng đã chọn"""
        if self.region_start and self.region_end:
            # Tọa độ trên scaled image
            x1, y1 = self.region_start
            x2, y2 = self.region_end
            
            # Convert về tọa độ ảnh gốc
            orig_x1 = int(x1 / self.scale_ratio)
            orig_y1 = int(y1 / self.scale_ratio)
            orig_width = int((x2 - x1) / self.scale_ratio)
            orig_height = int((y2 - y1) / self.scale_ratio)
            
            self.region_info_label.config(
                text=f"({orig_x1}, {orig_y1}) | {orig_width}x{orig_height}px"
            )
        else:
            self.region_info_label.config(text="")
    
    def reset_region(self):
        """Reset vùng đã chọn"""
        if self.rect_id:
            self.canvas.delete(self.rect_id)
        
        self.region_start = None
        self.region_end = None
        self.rect_id = None
        self.update_region_info()
        self.log("🔄 Reset")
    
    def save_coordinates(self):
        """Lưu tọa độ vùng đã chọn ra file JSON"""
        coords = self.get_region_coordinates()
        if not coords:
            messagebox.showwarning("Cảnh báo", "Chưa chọn vùng nào!\nVui lòng vẽ vùng trên frame trước.")
            return
        
        # Chọn nơi lưu file
        filename = filedialog.asksaveasfilename(
            title="Lưu tọa độ vùng",
            defaultextension=".json",
            filetypes=[("JSON files", "*.json"), ("Text files", "*.txt"), ("All files", "*.*")]
        )
        
        if filename:
            try:
                # Thêm thông tin video nếu có
                data = {
                    "region": coords,
                    "video_file": os.path.basename(self.video_path) if self.video_path else "N/A"
                }
                
                with open(filename, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=4, ensure_ascii=False)
                
                self.log(f"💾 Đã lưu: {filename}")
                messagebox.showinfo("Thành công", f"Đã lưu tọa độ vào:\n{filename}")
                
            except Exception as e:
                self.log(f"❌ Lỗi: {str(e)}")
                messagebox.showerror("Lỗi", f"Không thể lưu file:\n{str(e)}")
    
    def get_region_coordinates(self):
        """
        Lấy tọa độ vùng đã chọn (tọa độ ảnh gốc)
        
        Returns:
            dict: {"x": x1, "y": y1, "width": width, "height": height} hoặc None
        """
        if self.region_start and self.region_end:
            # Tọa độ trên scaled image
            x1, y1 = self.region_start
            x2, y2 = self.region_end
            
            # Convert về tọa độ ảnh gốc
            orig_x1 = int(x1 / self.scale_ratio)
            orig_y1 = int(y1 / self.scale_ratio)
            orig_width = int((x2 - x1) / self.scale_ratio)
            orig_height = int((y2 - y1) / self.scale_ratio)
            
            return {
                "x": orig_x1,
                "y": orig_y1,
                "width": orig_width,
                "height": orig_height
            }
        return None
    
    def browse_srt(self):
        """Chọn file SRT"""
        filetypes = [
            ("SRT files", "*.srt"),
            ("All files", "*.*")
        ]
        filename = filedialog.askopenfilename(title="Chọn file SRT", filetypes=filetypes)
        if filename:
            self.srt_path_var.set(filename)
            self.log(f"✅ SRT: {filename}")
    
    def browse_ass(self):
        """Chọn file ASS và hiển thị caption preview"""
        filetypes = [
            ("ASS files", "*.ass"),
            ("All files", "*.*")
        ]
        filename = filedialog.askopenfilename(title="Chọn file ASS", filetypes=filetypes)
        if filename:
            self.ass_path_var.set(filename)
            self.log(f"✅ ASS: {filename}")
            
            # Parse ASS và hiển thị caption preview
            try:
                sample_text = self._parse_ass_sample(filename)
                if sample_text and self.current_frame is not None:
                    self._show_caption_preview(sample_text)
                    self.log(f"📝 Caption preview: '{sample_text[:30]}...'")
            except Exception as e:
                self.log(f"⚠️ Không thể preview caption: {str(e)}")
    
    def _parse_ass_sample(self, ass_path):
        """Parse ASS file và lấy text mẫu từ dialogue đầu tiên"""
        try:
            with open(ass_path, 'r', encoding='utf-8') as f:
                for line in f:
                    if line.startswith('Dialogue:'):
                        # Format: Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
                        parts = line.split(',', 9)
                        if len(parts) >= 10:
                            text = parts[9].strip()
                            # Remove ASS tags like {\pos(x,y)}
                            import re
                            text = re.sub(r'\{[^}]*\}', '', text)
                            # Remove \N line breaks
                            text = text.replace('\\N', ' ')
                            return text if text else "Sample Caption"
            return "Sample Caption"
        except:
            return "Sample Caption"
    
    def _show_caption_preview(self, text):
        """Hiển thị caption preview trên canvas, cho phép drag"""
        # Xóa caption cũ nếu có
        if hasattr(self, 'caption_preview_id') and self.caption_preview_id:
            self.canvas.delete(self.caption_preview_id)
        
        # Lấy font settings
        font_name = self.font_name_var.get() or "Be Vietnam Pro"
        try:
            font_size = int(self.font_size_var.get() or 48)
        except:
            font_size = 48
        
        # Scale font size theo scale ratio
        scaled_font_size = int(font_size * self.scale_ratio)
        
        # Vị trí mặc định: center-bottom
        canvas_width = self.canvas.winfo_width()
        canvas_height = self.canvas.winfo_height()
        
        # Nếu có saved coordinates, dùng nó
        if self.saved_coordinates:
            # Convert từ original coordinates sang scaled canvas coordinates
            orig_y = self.saved_coordinates["y"]
            x = canvas_width // 2  # Center horizontal
            y = int(orig_y * self.scale_ratio) + self.image_offset_y
        else:
            # Default: bottom center
            x = canvas_width // 2
            y = canvas_height - 100
        
        # Tạo text object
        self.caption_preview_id = self.canvas.create_text(
            x, y,
            text=text,
            fill=self.font_color_var.get() or "#FFFFFF",
            font=(font_name, scaled_font_size, "bold"),
            anchor="center",
            tags="caption_preview"
        )
        
        # Bind drag events
        self.canvas.tag_bind("caption_preview", "<ButtonPress-1>", self._on_caption_press)
        self.canvas.tag_bind("caption_preview", "<B1-Motion>", self._on_caption_drag)
        self.canvas.tag_bind("caption_preview", "<ButtonRelease-1>", self._on_caption_release)
        
        self.caption_drag_data = {"x": 0, "y": 0}
        
        self.log(f"🎯 Kéo caption để điều chỉnh vị trí, sau đó click '💾' để lưu")
    
    def _on_caption_press(self, event):
        """Bắt đầu drag caption"""
        self.caption_drag_data["x"] = event.x
        self.caption_drag_data["y"] = event.y
    
    def _on_caption_drag(self, event):
        """Drag caption"""
        if self.caption_preview_id:
            # Tính khoảng cách di chuyển
            dx = event.x - self.caption_drag_data["x"]
            dy = event.y - self.caption_drag_data["y"]
            
            # Di chuyển caption
            self.canvas.move(self.caption_preview_id, dx, dy)
            
            # Cập nhật drag data
            self.caption_drag_data["x"] = event.x
            self.caption_drag_data["y"] = event.y
    
    def _on_caption_release(self, event):
        """Kết thúc drag caption và auto-save tọa độ"""
        if self.caption_preview_id:
            # Lấy tọa độ hiện tại của caption
            coords = self.canvas.coords(self.caption_preview_id)
            if coords:
                x, y = coords[0], coords[1]
                
                # Convert về original coordinates
                orig_y = int((y - self.image_offset_y) / self.scale_ratio)
                
                # Auto-save coordinates
                if self.original_size[1] > 0:
                    margin_v = self.original_size[1] - orig_y
                    
                    self.saved_coordinates = {
                        "x": 0,  # Not used for center alignment
                        "y": orig_y,
                        "width": 0,
                        "height": 0
                    }
                    
                    # Update saved label
                    self.saved_coords_label.config(
                        text=f"y={orig_y}px, cách đáy {margin_v}px",
                        fg="#28a745"
                    )
                    
                    self.log(f"💾 Tự động lưu: y={orig_y}, MarginV={margin_v}px")
                    self.update_region_info()  # Clear region info
    
    def toggle_selection_mode(self):
        """Toggle giữa Region selection và Caption drag mode"""
        self.region_selection_enabled = not self.region_selection_enabled
        
        if self.region_selection_enabled:
            # Region mode  
            self.mode_button.config(text="🔲 Vùng", bg="#ffc107")
            self.log("🔲 Chế độ: Vẽ vùng (drag để chọn vùng)")
        else:
            # Caption mode
            self.mode_button.config(text="📝 Caption", bg="#17a2b8")
            self.log("📝 Chế độ: Caption (drag caption để di chuyển)")
    
    def save_caption_position(self):
        """Lưu tọa độ caption hiện tại"""
        if not self.caption_preview_id:
            messagebox.showwarning("Cảnh báo", "Chưa có caption preview!\n\nHãy load file ASS trước.")
            return
        
        # Lấy tọa độ caption hiện tại
        coords = self.canvas.coords(self.caption_preview_id)
        if coords:
            x, y = coords[0], coords[1]
            
            # Convert về original coordinates
            orig_y = int((y - self.image_offset_y) / self.scale_ratio)
            
            if self.original_size[1] > 0:
                margin_v = self.original_size[1] - orig_y
                
                self.saved_coordinates = {
                    "x": 0,
                    "y": orig_y,
                    "width": 0,
                    "height": 0
                }
                
                # Update saved label
                self.saved_coords_label.config(
                    text=f"y={orig_y}px, cách đáy {margin_v}px",
                    fg="#28a745"
                )
                
                self.log(f"💾 Đã lưu vị trí caption: y={orig_y}, MarginV={margin_v}px")
                messagebox.showinfo("Đã lưu", f"Vị trí caption:\ny={orig_y}px\nCách đáy: {margin_v}px")
            else:
                messagebox.showerror("Lỗi", "Không thể tính toán tọa độ")
        else:
            messagebox.showerror("Lỗi", "Không thể lấy tọa độ caption")

# --- SRT to ASS Conversion Logic ---

def srt_time_to_ass(t):
    """Convert SRT timestamp (00:00:00,000) to ASS timestamp (H:MM:SS.cs)"""
    t = t.replace(',', '.')
    parts = t.split(':')
    if len(parts) == 3:
        h = int(parts[0])
        m = parts[1]
        s_parts = parts[2].split('.')
        s = s_parts[0]
        ms = s_parts[1]
        # ASS needs centiseconds (2 digits), SRT has milliseconds (3 digits)
        cs = ms[:2]
        return f"{h}:{m}:{s}.{cs}"
    return t

def hex_to_ass_color(hex_color):
    """Convert HEX color (#RRGGBB) to ASS color (&H00BBGGRR)"""
    hex_color = hex_color.lstrip('#')
    if len(hex_color) == 6:
        r, g, b = hex_color[0:2], hex_color[2:4], hex_color[4:6]
        # ASS uses BGR format
        return f"&H00{b.upper()}{g.upper()}{r.upper()}"
    return "&H00FFFFFF"

def parse_srt(srt_path):
    """Parse SRT file to list of dicts"""
    with open(srt_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Split by double newline (blank line between subtitles)
    blocks = content.strip().split('\n\n')
    # If standard split fails try regex
    if len(blocks) < 2:
        import re
        blocks = re.split(r'\n\s*\n', content.strip())

    subtitles = []
    for block in blocks:
        lines = block.strip().split('\n')
        if len(lines) < 3:
            continue
        
        timing_idx = 0
        if ' --> ' in lines[0]:
            timing_idx = 0
        elif len(lines) > 1 and ' --> ' in lines[1]:
            timing_idx = 1
        else:
            continue
            
        timing = lines[timing_idx]
        text = '\n'.join(lines[timing_idx+1:])
        
        if ' --> ' in timing:
            s, e = timing.split(' --> ')
            subtitles.append({
                'start': srt_time_to_ass(s.strip()),
                'end': srt_time_to_ass(e.strip()),
                'text': text
            })
    
    print(f"Parsed {len(subtitles)} subtitles from {srt_path}")  # Debug
    return subtitles

def convert_srt_to_ass(srt_path, ass_path, video_resolution=(1920, 1080), 
                      font_name="Arial", font_size=48, font_color="#FFFFFF",
                      margin_v=50, position=None, shadow=2, alignment=2):
    """
    Convert SRT to ASS with styling and optional position
    
    Args:
        shadow: Shadow depth (0=no shadow, 2=medium, 3=strong)
        alignment: ASS Alignment (2=Bottom Center, 5=Middle Center, etc.)
    """
    w, h = video_resolution
    ass_color = hex_to_ass_color(font_color)
    # alignment is used from args
    
    content = f"""[Script Info]
Title: Converted by CapCutTool
ScriptType: v4.00+
PlayResX: {w}
PlayResY: {h}
ScaledBorderAndShadow: no

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_name},{font_size},{ass_color},&H000000FF,&H00000000,&HFF000000,0,0,0,0,100,100,0,0,1,2,{shadow},{alignment},10,10,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    
    subtitles = parse_srt(srt_path)
    print(f"Converting {len(subtitles)} subtitles to ASS format")  # Debug
    
    for sub in subtitles:
        txt = sub['text'].replace('\n', '\\N')
        if position:
            px, py = position
            txt = f"{{\\pos({px},{py})}}{txt}"
        content += f"Dialogue: 0,{sub['start']},{sub['end']},Default,,0,0,0,,{txt}\n"
        
    with open(ass_path, 'w', encoding='utf-8') as f:
        f.write(content)
        
    return True

def get_sample_caption(file_path):
    """
    Get a sample caption text from SRT or ASS file for preview.
    Returns the first non-empty dialogue text found.
    """
    if not os.path.exists(file_path):
        return "Sample Caption"
        
    ext = os.path.splitext(file_path)[1].lower()
    
    try:
        if ext == '.srt':
            # Use existing parse_srt
            subs = parse_srt(file_path)
            if subs:
                # Return first one, or maybe one in the middle? 
                # Let's return the first one that is long enough to look good
                for sub in subs:
                    t = sub['text'].replace('\n', ' ')
                    if len(t) > 5: return t
                return subs[0]['text'].replace('\n', ' ') if subs else "Sample Caption (SRT)"
                
        elif ext == '.ass':
            with open(file_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
                
            for line in lines:
                # Try with and without BOM/whitespace
                line_stripped = line.strip()
                if line_stripped.startswith('Dialogue:'):
                    # Format: Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
                    parts = line_stripped.split(',', 9)
                    if len(parts) >= 10:
                        text = parts[9].strip()
                        # Simply remove ASS tags like {\pos(x,y)}
                        import re
                        text = re.sub(r'\{[^}]*\}', '', text)
                        # Replace ASS line breaks
                        text = text.replace('\\N', ' ').replace('\\n', ' ')
                        text = text.strip()
                        if len(text) > 0:
                            print(f"Found caption: {text[:100]}")  # Debug
                            return text
            
            print(f"No valid Dialogue lines found in {file_path}")  # Debug
            return "Sample Caption (ASS)"
            
    except Exception as e:
        print(f"Error reading sample caption: {e}")
        import traceback
        traceback.print_exc()
        
    return "Sample Caption Preview"

def render_ass_to_video(ass_path, output_path, width=1920, height=200, duration=None, use_gpu=True, progress_callback=None):
    """
    Render ASS subtitle file to video with black background
    
    Args:
        ass_path: Path to ASS file
        output_path: Output MP4 path
        width: Video width
        height: Video height
        duration: Duration in seconds (None = auto-detect from ASS)
        use_gpu: Use GPU encoding if available (NVIDIA h264_nvenc)
        progress_callback: Function(frame, total_frames, fps, message) called during render
    
    Returns:
        tuple: (success: bool, process: subprocess.Popen or None)
    """
    import subprocess
    import re
    
    # Parse ASS to get duration if needed
    if duration is None:
        duration = get_ass_duration(ass_path)
        if duration is None:
            duration = 10  # Default fallback
        print(f"Auto-detected duration: {duration}s")
    
    # Calculate total frames
    fps = 30
    total_frames = int(duration * fps)
    
    # Prepare FFmpeg command
    # Create black video with ASS subtitles burned in
    
    # GPU encoder selection
    if use_gpu:
        # Try Intel Quick Sync (integrated GPU - always available on laptops)
        video_codec = "h264_qsv"
        codec_params = ["-preset", "medium", "-global_quality", "23"]  # Intel QSV presets
    else:
        video_codec = "libx264"
        codec_params = ["-preset", "medium"]
    
    # FFmpeg command:
    # 1. Create black video source: color=black:s=WxH:d=duration
    # 2. Burn ASS subtitles: -vf "ass=file.ass"
    # 3. Encode with GPU
    
    # Escape ASS path for FFmpeg filter
    ass_filter = ass_path.replace('\\', '/').replace(':', '\\:')
    
    # Define fonts directory (app/assets/font)
    font_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "font")
    # Ensure correct path format for ffmpeg
    font_dir = font_dir.replace('\\', '/').replace(':', '\\:')
    
    # Add fontsdir to ass filter
    # Syntax: ass='filename':fontsdir='dir'
    ass_filter_full = f"ass='{ass_filter}':fontsdir='{font_dir}'"
    
    cmd = [
        "ffmpeg",
        "-f", "lavfi",
        "-i", f"color=black:s={width}x{height}:d={duration}:r={fps}",
        "-vf", ass_filter_full,
        "-c:v", video_codec,
        *codec_params,
        "-pix_fmt", "yuv420p",
        "-y",
        output_path
    ]
    
    print(f"FFmpeg command: {' '.join(cmd)}")
    
    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='replace',
            bufsize=1,
            universal_newlines=True
        )
        
        # Read stderr for progress (FFmpeg outputs to stderr)
        current_frame = 0
        stderr_lines = []
        
        for line in iter(process.stderr.readline, ''):
            if not line:
                break
            line_stripped = line.strip()
            stderr_lines.append(line)  # Collect all stderr
            
            # Parse frame number from FFmpeg output
            # Format: "frame= 1234 fps=..."
            if 'frame=' in line_stripped:
                match = re.search(r'frame=\s*(\d+)', line_stripped)
                if match:
                    current_frame = int(match.group(1))
                    if progress_callback and total_frames > 0:
                        percent = min(100, int((current_frame / total_frames) * 100))
                        # Create progress bar
                        bar_length = 30
                        filled = int((percent / 100) * bar_length)
                        bar = '|' * filled + ' ' * (bar_length - filled)
                        progress_callback(current_frame, total_frames, fps, f"[{bar}] {percent}%")
        
        # Wait for completion
        process.wait()
        
        # Get full stderr output
        stderr_output = ''.join(stderr_lines)
        
        if process.returncode == 0:
            print(f"Video rendered successfully: {output_path}")
            if progress_callback:
                progress_callback(total_frames, total_frames, fps, "✅ Hoàn thành!")
            return (True, None)
        else:
            print(f"FFmpeg failed with return code: {process.returncode}")
            print(f"FFmpeg stderr output:\n{stderr_output}")
            
            # If GPU encoding failed, try CPU
            if use_gpu and ("qsv" in stderr_output.lower() or "vaapi" in stderr_output.lower() or "decode" in stderr_output.lower()):
                print("GPU encoding failed, retrying with CPU...")
                return render_ass_to_video(ass_path, output_path, width, height, duration, use_gpu=False, progress_callback=progress_callback)
            return (False, None)
            
    except Exception as e:
        print(f"Error rendering video: {e}")
        import traceback
        traceback.print_exc()
        return (False, None)

def get_ass_duration(ass_path):
    """Get duration from ASS file by finding the last subtitle end time"""
    try:
        with open(ass_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        max_time = 0
        for line in lines:
            if line.strip().startswith('Dialogue:'):
                # Format: Dialogue: Layer,Start,End,Style,...
                parts = line.strip().split(',', 3)
                if len(parts) >= 3:
                    end_time_str = parts[2].strip()  # H:MM:SS.cs format
                    # Convert to seconds
                    time_parts = end_time_str.replace('.', ':').split(':')
                    if len(time_parts) >= 3:
                        try:
                            h = int(time_parts[0])
                            m = int(time_parts[1])
                            s = int(time_parts[2])
                            total_seconds = h * 3600 + m * 60 + s
                            max_time = max(max_time, total_seconds)
                        except:
                            pass
        
        if max_time > 0:
            return max_time + 2  # Add 2 seconds buffer
        
    except Exception as e:
        print(f"Error parsing ASS duration: {e}")
    
    return None


