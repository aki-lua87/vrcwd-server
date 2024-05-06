using UdonSharp;
using UnityEngine;
using VRC.SDKBase;
using VRC.Udon;
using VRC.SDK3.StringLoading;
using VRC.Udon.Common.Interfaces;
using VRC.SDK3.Data;
using VRC.Udon.Serialization.OdinSerializer;
using VRC.SDK3.Components;

public class GetHistory : UdonSharpBehaviour
{
    private readonly string logPrefix = "[aki_lua87] WorldsHistory: ";
    [SerializeField] private GameObject vrcPortalMarkerGameObject;
    // [SerializeField] private VRCPortalMarker vrcPortalMarker;
    // private VRCPortalMarker vrcPortalMarker;
    [SerializeField] private VRCUrl url;

    [SerializeField] private float offsetX = 0f;
    [SerializeField] private float offsetZ = 0f;

    private float nextPortalPositionX = 0f;
    private float nextPortalPositionZ = 0f;

    private string[] worldids = new string[100];
    void Start()
    {
        nextPortalPositionX = vrcPortalMarkerGameObject.transform.position.x;
        nextPortalPositionZ = vrcPortalMarkerGameObject.transform.position.z;
        vrcPortalMarkerGameObject.SetActive(false);
        // URLをコール
        VRCStringDownloader.LoadUrl(url, (IUdonEventReceiver)this);
    }

    public override void OnStringLoadSuccess(IVRCStringDownload download)
    {
        var downloadString = download.Result;
        var callURL = download.Url.Get();
        Debug.Log($"{logPrefix}OnStringLoadSuccess:" + callURL);
        Debug.Log($"{logPrefix}OnStringLoadSuccess:" + downloadString);
        if (VRCJson.TryDeserializeFromJson(downloadString, out DataToken result))
        {
            Debug.Log($"{logPrefix} if 1");
            // 配列(DataList)であるか
            if (result.TokenType == TokenType.DataList)
            {
                Debug.Log($"{logPrefix} if 2");
                // 配列(DataList)の各要素について
                for (int i = 0; i < result.DataList.Count; i++)
                {
                    Debug.Log($"{logPrefix} for {i}");
                    // 配列(DataList)の各要素が辞書(DataDictionary)であるか
                    DataToken value;
                    if (result.DataList.TryGetValue(i, TokenType.DataDictionary, out value))
                    {
                        Debug.Log($"{logPrefix} if 3");
                        var worldID = value.DataDictionary["world_id"].ToString();
                        var worldName = value.DataDictionary["world_name"].ToString();
                        Debug.Log($"{logPrefix} worldID: {worldID}, worldName: {worldName}");
                        if (worldName == null)
                        {
                            worldName = "Unknown";
                        }
                        CreatePortal(worldID, worldName);
                        if (i < 100)
                        {
                            worldids[i] = worldID;
                        }
                    }
                }
            }
        }
    }

    public override void OnStringLoadError(IVRCStringDownload result)
    {
        Debug.Log($"{logPrefix}OnStringLoadError:");
        Debug.Log(result.Error);
    }

    private void CreatePortal(string worldID, string worldName)
    {
        Debug.Log($"{logPrefix} CreatePortal: {worldID}, {worldName}");
        var portal = Instantiate(vrcPortalMarkerGameObject);
        var vrcPortalMarker = portal.GetComponent<VRCPortalMarker>();
        vrcPortalMarker.roomId = worldID;
        vrcPortalMarker.RefreshPortal();
        portal.transform.position = new Vector3(nextPortalPositionX, 0, nextPortalPositionZ);
        nextPortalPositionX += offsetX;
        nextPortalPositionZ += offsetZ;
        portal.SetActive(true);
        vrcPortalMarker.RefreshPortal();
    }
}
