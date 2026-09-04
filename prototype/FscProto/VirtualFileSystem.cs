using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using FSharp.Compiler.IO;
using Microsoft.FSharp.Core;

/// <summary>
/// In-memory file system backing FSharp.Compiler.Service, so F# compilation works
/// on WebAssembly without any real file system.
/// </summary>
public sealed class VirtualFileSystem : IFileSystem
{
    readonly Dictionary<string, byte[]> _files = new Dictionary<string, byte[]>(StringComparer.Ordinal);

    public IAssemblyLoader AssemblyLoader { get; } = new DefaultAssemblyLoaderImpl();

    public void AddFile(string path, byte[] contents) =>
        _files[Normalize(path)] = contents;

    public void AddFile(string path, string contents) =>
        AddFile(path, Encoding.UTF8.GetBytes(contents));

    public byte[] GetFile(string path) => _files.TryGetValue(Normalize(path), out var b) ? b : null;

    public void Clear() => _files.Clear();

    public static string Normalize(string path)
    {
        if (string.IsNullOrEmpty(path)) return path;
        path = path.Replace('\\', '/');
        // collapse duplicate slashes and resolve ".."
        var parts = path.Split('/').Where(p => p.Length > 0 && p != ".").ToList();
        var stack = new List<string>();
        foreach (var p in parts)
        {
            if (p == ".." && stack.Count > 0 && stack[^1] != "..")
                stack.RemoveAt(stack.Count - 1);
            else
                stack.Add(p);
        }
        return "/" + string.Join("/", stack);
    }

    public Stream OpenFileForReadShim(string filePath, FSharpOption<bool> useMemoryMappedFile, FSharpOption<bool> shouldShadowCopy)
    {
        if (_files.TryGetValue(Normalize(filePath), out var bytes))
            return new MemoryStream(bytes, writable: false);
        throw new FileNotFoundException($"Virtual file not found: {filePath}");
    }

    public Stream OpenFileForWriteShim(string filePath, FSharpOption<FileMode> fileMode, FSharpOption<FileAccess> fileAccess, FSharpOption<FileShare> fileShare)
    {
        var path = Normalize(filePath);
        return new VfsWriteStream(this, path);
    }

    sealed class VfsWriteStream : MemoryStream
    {
        readonly VirtualFileSystem _fs;
        readonly string _path;
        public VfsWriteStream(VirtualFileSystem fs, string path) { _fs = fs; _path = path; }
        protected override void Dispose(bool disposing)
        {
            if (disposing)
                _fs._files[_path] = ToArray();
            base.Dispose(disposing);
        }
    }

    public string GetFullPathShim(string fileName) => Normalize(fileName);
    public string GetFullFilePathInDirectoryShim(string dir, string fileName) => Normalize(Path.Combine(dir, fileName).Replace('\\', '/'));
    public bool IsPathRootedShim(string path) => path.StartsWith("/") || (path.Length >= 2 && path[1] == ':');
    public string NormalizePathShim(string path) => Normalize(path);
    public bool IsInvalidPathShim(string path) => string.IsNullOrEmpty(path);
    public string GetTempPathShim() => "/tmp";
    public string GetDirectoryNameShim(string path)
    {
        var n = Normalize(path);
        var i = n.LastIndexOf('/');
        return i <= 0 ? "/" : n.Substring(0, i);
    }
    static readonly DateTime FixedTime = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    public DateTime GetLastWriteTimeShim(string fileName) => FixedTime;
    public DateTime GetCreationTimeShim(string path) => FixedTime;
    public void CopyShim(string src, string dest, bool overwrite)
    {
        if (!overwrite && _files.ContainsKey(Normalize(dest))) return;
        if (_files.TryGetValue(Normalize(src), out var b))
            _files[Normalize(dest)] = b;
    }
    public bool FileExistsShim(string fileName) => _files.ContainsKey(Normalize(fileName));
    public void FileDeleteShim(string fileName) => _files.Remove(Normalize(fileName));
    public string DirectoryCreateShim(string path) { return Normalize(path); }
    public bool DirectoryExistsShim(string path) => true;
    public void DirectoryDeleteShim(string path) { }
    public IEnumerable<string> EnumerateFilesShim(string path, string pattern)
    {
        var dir = Normalize(path);
        var prefix = dir == "/" ? "/" : dir + "/";
        return _files.Keys.Where(k => k.StartsWith(prefix)).ToList();
    }
    public IEnumerable<string> EnumerateDirectoriesShim(string path) => Enumerable.Empty<string>();
    public bool IsStableFileHeuristic(string fileName) => true;
    public string ChangeExtensionShim(string path, string extension)
    {
        var i = path.LastIndexOf('.');
        return i >= 0 ? path.Substring(0, i) + extension : path + extension;
    }
}

public sealed class DefaultAssemblyLoaderImpl : IAssemblyLoader
{
    public Assembly AssemblyLoadFrom(string fileName) => Assembly.LoadFrom(fileName);
    public Assembly AssemblyLoad(AssemblyName assemblyName) => Assembly.Load(assemblyName);
}