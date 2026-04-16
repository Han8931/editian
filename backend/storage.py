import logging
import os
from pathlib import Path

import boto3

logger = logging.getLogger(__name__)


class StorageConfigError(RuntimeError):
    pass


class S3DocumentStorage:
    def __init__(
        self,
        bucket: str,
        region: str | None = None,
        endpoint_url: str | None = None,
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        prefix: str = "editian",
    ) -> None:
        if not bucket:
            raise StorageConfigError("S3_BUCKET is required.")

        self.bucket = bucket
        self.prefix = prefix.strip("/") or "editian"
        self.client = boto3.client(
            "s3",
            region_name=region or None,
            endpoint_url=endpoint_url or None,
            aws_access_key_id=access_key_id or None,
            aws_secret_access_key=secret_access_key or None,
        )

    @classmethod
    def from_env(cls) -> "S3DocumentStorage":
        return cls(
            bucket=os.getenv("S3_BUCKET", ""),
            region=os.getenv("AWS_REGION") or os.getenv("S3_REGION"),
            endpoint_url=os.getenv("S3_ENDPOINT_URL"),
            access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            prefix=os.getenv("S3_PREFIX", "editian"),
        )

    def build_key(self, file_id: str, filename: str) -> str:
        safe_name = Path(filename).name
        return f"{self.prefix}/files/{file_id}/{safe_name}"

    def upload_file(self, local_path: str | Path, key: str) -> None:
        logger.debug("uploading file to s3 key=%s local_path=%s bucket=%s", key, local_path, self.bucket)
        self.client.upload_file(str(local_path), self.bucket, key)

    def download_file(self, key: str, local_path: str | Path) -> None:
        path = Path(local_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        logger.debug("downloading file from s3 key=%s local_path=%s bucket=%s", key, local_path, self.bucket)
        self.client.download_file(self.bucket, key, str(path))

    def delete_file(self, key: str) -> None:
        logger.debug("deleting file from s3 key=%s bucket=%s", key, self.bucket)
        self.client.delete_object(Bucket=self.bucket, Key=key)
